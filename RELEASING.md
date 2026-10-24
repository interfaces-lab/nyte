# Releasing

Nyte ships one version. The seven SDK packages, the `nyte-ai` launcher, the TUI, the desktop app,
the iOS app and the two deployable examples share it. `release.packages` in the root
`package.json` lists them. The version comes from git tags, not from the checked-in manifests: a
release adds a bump to the highest stable `v<x.y.z>` tag.

## Contributors

Nothing to do. Pull requests carry no release metadata. Write commit messages and pull request
descriptions that say what changed for users, since the release notes start from them.

## Maintainers

From a checkout with `gh` signed in and a Nyte model configured:

```sh
pnpm release            # patch
pnpm release minor
pnpm release 0.1.0-beta.1
```

`scripts/release.mjs` fetches `origin/main` and the tags. It stops if `HEAD` has commits that
`origin/main` lacks, since the workflow releases `origin/main`; push them or drop them first.
Uncommitted changes don't matter, because the notes describe commits.

The notes come from a Nyte session that reads every commit since the last stable tag. The session
runs on the `nyte host` named in `~/.nyte/host.json`, or on one the script starts from
`~/.nyte/bin/nyte` and stops afterwards, so the script opens no store of its own. A guard plugin,
`scripts/release-guard.mjs`, is copied to `~/.nyte/plugins/release-notes/` and assigned to that
session alone: it may read files and run read-only `git`, `gh`, `rg` and `grep` commands, plus
`git fetch` into remote-tracking refs and tags, and every other tool call is denied. The script
prints the session id, so you can follow it with `nyte --session=<id>`.

The notes open in `$VISUAL`, then `$EDITOR`. Edit the text between `<!-- changelog:start -->` and
`<!-- changelog:end -->`; the rest is a review of public API changes for you, and isn't published.
After you confirm, the script runs
`gh workflow run release.yml --ref main -f bump=<bump> -f release_notes=<notes>`.
`pnpm release --print` writes the notes to stdout and stops there; it runs with unpushed commits.

`.github/workflows/release.yml` then:

1. Resolves the version: `version` as given, otherwise the latest stable tag plus `bump`.
2. For a stable version, commits `release: v<version> [skip ci]` on top of the commit the run
   started from and pushes it to `main`. It holds the version in every release package and a
   `## v<version> — <date>` entry at the top of `CHANGELOG.md`. If `main` moved in the meantime,
   the push fails; start the release again.
3. Checks out that commit and checks that the release packages share one version, then runs format,
   lint, typecheck, build, tests, `sdk:check`, `sdk:pack` and `sdk:verify` on Linux. It exports the
   web and canvas builds for every desktop target.
4. Builds, signs and notarizes the `nyte` binaries, and builds the desktop app.
5. Uploads both to a draft GitHub release `v<version>`.
6. Publishes the SDK packages to npm with `pnpm -r publish`, in dependency order, with provenance.
7. Tags the release commit `v<version>` and publishes the GitHub release, with the reviewed notes
   as its body when given and generated notes otherwise.
8. Publishes `nyte-ai` last, so the launcher never points at assets a draft still hides.

So `v<version>` names the commit whose package manifests say `<version>`. Versions with a `-` skip
step 2: they build the commit the run started from, write the version into the manifests only at
publish time, and tag that commit. They publish to the npm `next` dist-tag and as a GitHub
prerelease. The rest publish to `latest`. `nyte update`, the desktop updater and npm `latest` follow
stable releases only.

Every step can run again. Step 2 reuses the commit the `v<version>` tag names, or else the
`release: v<version> [skip ci]` commit on `main`, so a rerun never makes a second one.
`pnpm -r publish` skips versions npm already has, and the tag and release steps check what exists.
To resume a failed run, re-run it from the Actions page, or start **Release** by hand with
`version` set. A new run with only `bump` picks the same version until the tag exists, and the next
one after.

Nightly builds go through the same workflow. See
[scripts/README.md](scripts/README.md#nightly-releases).

For a Mac desktop build without Actions or publication, use the
[Linux-to-Mac build command](scripts/README.md#delegate-a-mac-desktop-build).
Routine CI runs macOS unit tests only on `main` and `release/**`, after Linux verification
passes. Pull requests keep Linux and Windows tests; **Test on one OS** remains available
for explicit native checks.

## One-time setup

- **npm trusted publishing.** On npmjs.com, open each package's settings (`@nyte-ai/schema`,
  `@nyte-ai/ai`, `@nyte-ai/core`, `@nyte-ai/plugin`, `@nyte-ai/protocol`, `@nyte-ai/host`,
  `@nyte-ai/sdk` and `nyte-ai`) and keep two GitHub Actions trusted publishers for
  `interfaces-lab/nyte`: `release.yml` for releases, and `nightly.yml` for nightlies. npm checks the
  workflow that started the run, which for a nightly is `nightly.yml` even though `release.yml`
  publishes. Remove the old `changesets.yml` publisher. npm accepts trusted publishing only from
  GitHub-hosted runners, so the publish job runs on `ubuntu-latest`.
- **First publish of a new package.** npm configures trusted publishers only on a package that
  exists. For a new package's first release, add a granular `NPM_TOKEN` repository secret that can
  publish to the `@nyte-ai` scope. The publish job uses it when set. Configure the trusted
  publishers afterwards and delete the secret.
- **GitHub App for the commit to `main`.** `main` is protected, so the workflow's own token can't
  push to it. Create a GitHub App owned by `interfaces-lab` with **Contents: Read and write**,
  install it on `interfaces-lab/nyte` only, and add it to the bypass list of the `main` ruleset or
  branch protection. Save its App ID as the `RELEASE_APP_ID` repository variable and a private key
  as the `RELEASE_APP_PRIVATE_KEY` repository secret.
- **Existing secrets.** `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER` and `CENTRAL_LICENSE_KEY` stay as they are, along with the
  `NYTE_CONNECT_ORIGIN`, `NYTE_CLERK_PUBLISHABLE_KEY` and `NYTE_CLERK_FRONTEND_API_HOST` variables.
