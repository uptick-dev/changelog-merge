# changelog-merge

Merges per-PR changelog fragments (`changelog/{PR}-CHANGES.md`) into a single
combined changelog file, grouping entries under matching category headers.

Part of the changelog actions suite:
`changelog-generate` → **`changelog-merge`** → `changelog-release` → `changelog-notify`.

## Usage

```yaml
- uses: uptick-dev/changelog-merge@v1
  id: merge
  with:
    fragments-dir: changelog
    output-file: CHANGES_COMBINED.md

- if: steps.merge.outputs.has-fragments == 'false'
  run: echo "No fragments found — fall back to git-cliff"
```

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `fragments-dir` | `changelog` | Directory containing `*-CHANGES.md` fragment files. |
| `output-file` | `CHANGES_COMBINED.md` | Path to write the combined changelog. |
| `semver` | `"false"` | Compute the next public semver version from the fragments' bump lines (see below). |
| `public-tags` | `""` | Newline-separated tags already published (e.g. from `git ls-remote --tags`). Non-semver tags are ignored. |
| `public-version-file` | `""` | File holding the last public version, read as another published version. Not written by this action. |
| `max-major` | `""` | Highest allowed major version; a major bump past it is published as minor. Empty means no cap. |
| `semver-floor` | `""` | Lowest version to publish (`X.Y.Z`). Empty means no floor. |

## Outputs

| Name | Description |
| --- | --- |
| `public-version` | Next public version (`X.Y.Z`, no `v`). Only with `semver: true`. |
| `bump` | Bump applied to it after the `max-major` cap. Only with `semver: true`. |
| `has-fragments` | `'true'` if any fragments were found and merged, else `'false'`. When `'false'`, no output file is written — the caller should fall back to generating a changelog from commits (e.g. git-cliff). |

## How fragments are merged

- **One fragment** → its category sections are emitted flat under `## [Unreleased]`.
- **Multiple fragments** → each is grouped under a `### {PR title}` sub-heading
  (falling back to `### PR #{number}`), with categories nested as `#### {category}`.
  The PR title is read from a `<!-- title: ... -->` comment that
  [`changelog-generate`](https://github.com/uptick-dev/changelog-generate)
  injects into each fragment.

## Public semver versions

Some projects release with an internal CalVer tag (from `changelog-release`)
but publish a semver version publicly, e.g. an SDK. With `semver: true`:

1. Each fragment's `<!-- bump: patch|minor|major -->` line is read (written by
   `changelog-generate` with `record-bump: true`; a trailing `(computed)` is
   accepted). A fragment without one counts as `patch`.
2. The highest bump across the release's fragments is applied to the highest
   semver among `public-tags` and `public-version-file`, capped by `max-major`
   and raised to `semver-floor`.
3. When a fragment is marked `major`, the combined changelog starts with a
   `### ⚠️ Breaking changes` section listing its `[**breaking**]` items (or its
   PR title when there are none), whether or not the cap applied.

```yaml
- name: List published tags
  id: public_tags
  shell: bash
  run: |
    {
      echo "tags<<PUBLIC_TAGS_EOF"
      git ls-remote --tags --refs "https://x-access-token:${TOKEN}@github.com/owner/public-repo.git" | sed 's#.*refs/tags/##'
      echo "PUBLIC_TAGS_EOF"
    } >> "$GITHUB_OUTPUT"

- uses: uptick-dev/changelog-merge@v1
  id: merge
  with:
    semver: true
    public-tags: ${{ steps.public_tags.outputs.tags }}
    public-version-file: config/public_version
    max-major: 1
    semver-floor: 1.1.0
```

## Development

Zero runtime dependencies (Node `fs`/`path` only). Tests use the Node built-in
test runner — no `npm install` required:

```sh
node --test
```
