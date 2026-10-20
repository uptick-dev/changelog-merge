const fs = require("fs");
const path = require("path");
const { maxBump, nextPublicVersion } = require("./semver");

const fragmentsDir = process.env.FRAGMENTS_DIR || "changelog";
const outputFile = process.env.OUTPUT_FILE || "CHANGES_COMBINED.md";
const githubOutput = process.env.GITHUB_OUTPUT;
const semver = process.env.SEMVER === "true";
// The highest allowed major version; a major bump past it is published as minor. Empty means no cap.
const maxMajorInput = (process.env.MAX_MAJOR || "").trim();
const semverFloor = (process.env.SEMVER_FLOOR || "").trim();
const publicVersionFile = process.env.PUBLIC_VERSION_FILE || "";
// Newline-separated tags from the public repository, so a version published there is never reused.
const publicTags = process.env.PUBLIC_TAGS || "";

function findFragments(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("-CHANGES.md"))
    .sort()
    .map((f) => path.join(dir, f));
}

function prNumberFromPath(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/^(\d+)-CHANGES\.md$/);
  return match ? match[1] : null;
}

function parseFragment(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const sections = new Map();
  let title = null;
  let bump = null;
  let currentHeader = null;

  for (const line of lines) {
    const titleMatch = line.match(/^<!--\s*title:\s*(.+?)\s*-->$/);
    // test.yml writes "<!-- bump: minor (computed) -->"; a line without "(computed)" is a manual override.
    const bumpMatch = line.match(
      /^<!--\s*bump:\s*(patch|minor|major)(\s*\(computed\))?\s*-->$/
    );
    if (titleMatch) {
      title = titleMatch[1];
    } else if (bumpMatch) {
      bump = bumpMatch[1];
    } else if (line.startsWith("### ")) {
      currentHeader = line;
      if (!sections.has(currentHeader)) {
        sections.set(currentHeader, []);
      }
    } else if (line.startsWith("## ") || line.startsWith("# ")) {
      currentHeader = null;
    } else if (currentHeader && line.startsWith("- ")) {
      sections.get(currentHeader).push(line);
    }
  }

  return { title, bump, sections };
}

// Fragments without a bump line (written before semver, or by hand) count as patch.
function releaseBump(fragments) {
  return maxBump(fragments.map((f) => parseFragment(f).bump || "patch"));
}

// cliff.toml prefixes breaking commits with this.
const BREAKING_MARKER = "[**breaking**]";

// "feat!: Remove X" -> "Remove X"
function stripConventionalPrefix(title) {
  return title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
}

// Lists the breaking items, which carry the BREAKING CHANGE: migration note. A fragment marked major without one falls back to its title.
function breakingChanges(fragments) {
  let output = "### ⚠️ Breaking changes\n";
  for (const filePath of fragments) {
    const { title, bump, sections } = parseFragment(filePath);
    if (bump !== "major") continue;
    const items = [...sections.values()]
      .flat()
      .filter((item) => item.includes(BREAKING_MARKER));
    if (items.length > 0) {
      for (const item of items) {
        output += item.replace(`${BREAKING_MARKER} `, "") + "\n";
      }
    } else {
      const heading = title
        ? stripConventionalPrefix(title)
        : `PR #${prNumberFromPath(filePath)}`;
      output += `- ${heading}\n`;
    }
  }
  return output + "\n";
}

function mergeFragments(fragments) {
  const merged = new Map();

  for (const filePath of fragments) {
    const { sections } = parseFragment(filePath);
    for (const [header, items] of sections) {
      if (!merged.has(header)) {
        merged.set(header, []);
      }
      merged.get(header).push(...items);
    }
  }

  return merged;
}

function formatOutput(fragments) {
  let output = "# Changelog\n\n## [Unreleased]\n\n";

  if (releaseBump(fragments) === "major") {
    output += breakingChanges(fragments);
  }

  if (fragments.length === 1) {
    const { sections } = parseFragment(fragments[0]);
    for (const [header, items] of sections) {
      if (items.length > 0) {
        output += header + "\n";
        for (const item of items) {
          output += item + "\n";
        }
        output += "\n";
      }
    }
  } else {
    for (const filePath of fragments) {
      const prNumber = prNumberFromPath(filePath);
      const { title, sections } = parseFragment(filePath);
      const hasItems = [...sections.values()].some(
        (items) => items.length > 0
      );
      if (!hasItems) continue;

      const heading = title || `PR #${prNumber}`;
      output += `### ${heading}\n\n`;
      for (const [header, items] of sections) {
        if (items.length > 0) {
          output += "#" + header + "\n";
          for (const item of items) {
            output += item + "\n";
          }
          output += "\n";
        }
      }
    }
  }

  return output;
}

function readFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8").trim() : "";
}

function publicVersion(fragments) {
  const maxMajor = maxMajorInput === "" ? Infinity : Number(maxMajorInput);
  if (!Number.isInteger(maxMajor) && maxMajor !== Infinity) {
    throw new Error(`max-major must be a whole number, got "${maxMajorInput}"`);
  }
  const published = [
    publicVersionFile ? readFile(publicVersionFile) : "",
    ...publicTags.split("\n"),
  ];
  return nextPublicVersion({
    bump: releaseBump(fragments),
    published,
    maxMajor,
    floor: semverFloor,
  });
}

function main() {
  const fragments = findFragments(fragmentsDir);
  if (semver) {
    const { version, bump } = publicVersion(fragments);
    console.log(`Next public version is ${version} (${bump})`);
    if (githubOutput) {
      fs.appendFileSync(githubOutput, `public-version=${version}\nbump=${bump}\n`);
    }
  }

  if (fragments.length === 0) {
    console.log("No changelog fragments found");
    if (githubOutput) {
      fs.appendFileSync(githubOutput, "has-fragments=false\n");
    }
    return;
  }

  console.log(`Found changelog fragments: ${fragments.join(", ")}`);
  const output = formatOutput(fragments);
  fs.writeFileSync(outputFile, output);
  console.log(`Written combined changelog to ${outputFile}`);

  if (githubOutput) {
    fs.appendFileSync(githubOutput, "has-fragments=true\n");
  }
}

// Allow importing for tests
if (require.main === module) {
  main();
} else {
  module.exports = {
    parseFragment,
    releaseBump,
    mergeFragments,
    formatOutput,
    findFragments,
    prNumberFromPath,
  };
}
