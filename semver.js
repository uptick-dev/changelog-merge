// Semver helpers for a public version computed from conventional commits, alongside the CalVer release tag.

const BUMPS = ["patch", "minor", "major"];

function maxBump(bumps) {
  return bumps.reduce(
    (max, bump) => (BUMPS.indexOf(bump) > BUMPS.indexOf(max) ? bump : max),
    "patch"
  );
}

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Highest semver among the candidates. Anything that is not X.Y.Z (CalVer tags) is ignored.
function latestVersion(candidates) {
  return candidates
    .map(parseVersion)
    .filter(Boolean)
    .reduce(
      (max, version) =>
        !max || compareVersions(version, max) > 0 ? version : max,
      null
    );
}

// Apply the major cap: a major bump past maxMajor is published as a minor bump.
function cappedBump(bump, current, maxMajor) {
  if (bump === "major" && current[0] + 1 > maxMajor) return "minor";
  return bump;
}

function increment(current, bump) {
  const [major, minor, patch] = current;
  if (bump === "major") return [major + 1, 0, 0];
  if (bump === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

// The next public version: bump the latest published version, apply the cap, and never go below floor.
function nextPublicVersion({ bump, published, maxMajor = Infinity, floor = "" }) {
  const current = latestVersion(published) || [0, 0, 0];
  const applied = cappedBump(bump, current, maxMajor);
  let next = increment(current, applied);
  const minimum = floor ? parseVersion(floor) : null;
  if (floor && !minimum) throw new Error(`semver-floor must be X.Y.Z, got "${floor}"`);
  if (minimum && compareVersions(next, minimum) < 0) next = minimum;
  return { version: next.join("."), bump: applied };
}

module.exports = {
  maxBump,
  parseVersion,
  latestVersion,
  cappedBump,
  nextPublicVersion,
};
