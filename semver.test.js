const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  maxBump,
  nextPublicVersion,
} = require("./semver");
const { parseFragment, releaseBump, formatOutput } = require("./merge");

function writeFragments(fragments) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fragments-"));
  return Object.entries(fragments).map(([pr, content]) => {
    const file = path.join(dir, `${pr}-CHANGES.md`);
    fs.writeFileSync(file, content);
    return file;
  });
}

function fragment({ title, bump, items = ["- Something"] }) {
  let content = "# Changelog\n\n## [Unreleased]\n";
  if (title) content += `<!-- title: ${title} -->\n`;
  if (bump) content += `<!-- bump: ${bump} -->\n`;
  return content + "\n### 🐛 Fixed\n" + items.join("\n") + "\n";
}

test("maxBump takes the highest", () => {
  assert.strictEqual(maxBump([]), "patch");
  assert.strictEqual(maxBump(["patch", "minor", "patch"]), "minor");
  assert.strictEqual(maxBump(["minor", "major"]), "major");
});

test("semver-floor sets the first semver release", () => {
  const published = ["1.0.30", "v1.0.30", "v1.0.29", "2026.10.14+1"];
  for (const bump of ["patch", "minor"]) {
    assert.deepStrictEqual(
      nextPublicVersion({ bump, published, maxMajor: 1, floor: "1.1.0" }),
      { version: "1.1.0", bump }
    );
  }
});

test("later releases bump the latest published version", () => {
  const published = ["1.0.30", "v1.0.30", "v1.1.0", "2026.10.21+1"];
  assert.strictEqual(
    nextPublicVersion({ bump: "minor", published, maxMajor: 1 }).version,
    "1.2.0"
  );
  assert.strictEqual(
    nextPublicVersion({ bump: "patch", published: ["1.2.0"], maxMajor: 1 })
      .version,
    "1.2.1"
  );
});

test("without a floor or cap, versions bump normally", () => {
  assert.deepStrictEqual(nextPublicVersion({ bump: "patch", published: [] }), {
    version: "0.0.1",
    bump: "patch",
  });
  assert.deepStrictEqual(
    nextPublicVersion({ bump: "major", published: ["v1.4.2"] }),
    { version: "2.0.0", bump: "major" }
  );
});

test("an invalid floor is an error", () => {
  assert.throws(() =>
    nextPublicVersion({ bump: "patch", published: [], floor: "2026.1.1+1" })
  );
});

test("max-major caps a major bump to minor", () => {
  assert.deepStrictEqual(
    nextPublicVersion({ bump: "major", published: ["1.2.1"], maxMajor: 1 }),
    { version: "1.3.0", bump: "minor" }
  );
  assert.deepStrictEqual(
    nextPublicVersion({ bump: "major", published: ["1.3.0"], maxMajor: 2 }),
    { version: "2.0.0", bump: "major" }
  );
});

test("parseFragment reads the bump line", () => {
  const [file] = writeFragments({
    1: fragment({ title: "feat: X", bump: "minor" }),
  });
  const { title, bump, sections } = parseFragment(file);
  assert.strictEqual(title, "feat: X");
  assert.strictEqual(bump, "minor");
  assert.deepStrictEqual([...sections.keys()], ["### 🐛 Fixed"]);
});

test("parseFragment reads a computed bump line", () => {
  const [file] = writeFragments({
    1: fragment({ title: "feat!: X", bump: "major (computed)" }),
  });
  assert.strictEqual(parseFragment(file).bump, "major");
});

test("releaseBump treats a missing bump line as patch", () => {
  const files = writeFragments({
    1: fragment({ title: "fix: A" }),
    2: fragment({ title: "feat: B", bump: "minor" }),
  });
  assert.strictEqual(releaseBump(files.slice(0, 1)), "patch");
  assert.strictEqual(releaseBump(files), "minor");
});

test("a major release starts with breaking changes", () => {
  const files = writeFragments({
    1: fragment({ title: "fix: A", bump: "patch" }),
    2: fragment({ title: "feat(sdk)!: Remove the v1 API", bump: "major" }),
  });
  const output = formatOutput(files);
  assert.ok(
    output.startsWith(
      "# Changelog\n\n## [Unreleased]\n\n### ⚠️ Breaking changes\n- Remove the v1 API\n\n### fix: A\n"
    ),
    output
  );
});

test("the breaking changes section lists breaking items with their migration note", () => {
  const files = writeFragments({
    1: fragment({
      title: "feat!: Require a site URL",
      bump: "major",
      items: [
        "- [**breaking**] Require a site URL in initiateView. Pass your site URL as siteUrl.",
        "- Unrelated fix",
      ],
    }),
  });
  assert.ok(
    formatOutput(files).startsWith(
      "# Changelog\n\n## [Unreleased]\n\n### ⚠️ Breaking changes\n- Require a site URL in initiateView. Pass your site URL as siteUrl.\n\n### 🐛 Fixed\n"
    )
  );
});

test("a minor release has no breaking changes section", () => {
  const files = writeFragments({
    1: fragment({ title: "feat: A", bump: "minor" }),
  });
  assert.ok(!formatOutput(files).includes("Breaking changes"));
});

test("main writes the public version and bump outputs", () => {
  const files = writeFragments({
    1: fragment({ title: "feat: A", bump: "minor" }),
  });
  const dir = path.dirname(files[0]);
  const publicVersion = path.join(dir, "public_version");
  const githubOutput = path.join(dir, "output");
  fs.writeFileSync(publicVersion, "1.1.0\n");
  fs.writeFileSync(githubOutput, "");

  execFileSync("node", [path.join(__dirname, "merge.js")], {
    env: {
      ...process.env,
      FRAGMENTS_DIR: dir,
      OUTPUT_FILE: path.join(dir, "combined.md"),
      SEMVER: "true",
      MAX_MAJOR: "1",
      SEMVER_FLOOR: "1.1.0",
      PUBLIC_VERSION_FILE: publicVersion,
      PUBLIC_TAGS: "v1.0.30\nv1.1.0",
      GITHUB_OUTPUT: githubOutput,
    },
  });

  assert.strictEqual(
    fs.readFileSync(githubOutput, "utf-8"),
    "public-version=1.2.0\nbump=minor\nhas-fragments=true\n"
  );
});

test("main skips the public version unless semver is on", () => {
  const files = writeFragments({
    1: fragment({ title: "feat: A", bump: "minor" }),
  });
  const dir = path.dirname(files[0]);
  const githubOutput = path.join(dir, "output");
  fs.writeFileSync(githubOutput, "");

  execFileSync("node", [path.join(__dirname, "merge.js")], {
    env: {
      ...process.env,
      FRAGMENTS_DIR: dir,
      OUTPUT_FILE: path.join(dir, "combined.md"),
      GITHUB_OUTPUT: githubOutput,
    },
  });

  assert.strictEqual(fs.readFileSync(githubOutput, "utf-8"), "has-fragments=true\n");
});
