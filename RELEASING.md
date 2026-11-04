# Releasing

Nyte ships one version. The seven SDK packages, the `nyte-ai` launcher, the TUI, the desktop app,
the iOS app and the two deployable examples share it. `release.packages` in the root
`package.json` lists them. The workflow reads the version from git tags, not from the checked-in
manifests. A release adds a bump to the highest stable `v<x.y.z>` tag.

## Contributors

You have nothing to do. Pull requests carry no release metadata. The release notes start from
commit messages and pull request descriptions, so write them to say what changed for users.

## Maintainers

From a checkout with `gh` signed in and a Nyte model configured, run one of these:

```sh
pnpm release            # patch
pnpm release minor
pnpm release major
pnpm release <version>
```

`scripts/release.mjs` fetches `origin/main` and the tags. The workflow releases `origin/main`,
so the script stops if `HEAD` has commits that `origin/main` lacks. Push or drop them first.
Uncommitted changes don't matter, because the notes describe commits.

A Nyte session writes the notes after it reads every commit since the last stable tag. To
describe another range, pass `--from <tag>` and `--to <ref>`. The session runs on the running
`nyte host` that `host.json` names. That file lives in `NYTE_HOME`, which defaults to `~/.nyte`.
If no host is running, the script starts one from `~/.nyte/bin/nyte` and stops it afterwards.
Set `NYTE_BINARY` to start a different binary. The script prints the session id, so you can
follow the session:

```sh
nyte --session=<id>
```

The script copies a guard plugin, `scripts/release-guard.mjs`, to
`~/.nyte/plugins/release-notes/` and assigns it to that session alone. The guard lets the
session read files, list folders and run read-only `git`, `gh`, `rg` and `grep` commands. It also
allows `git fetch` into remote-tracking refs and tags, and piping output into `head`, `tail`,
`wc`, `sort`, `uniq` or `cut`. It denies every other tool call.

The notes open in `$VISUAL`, then `$EDITOR`, then `vi`. Edit the text between
`<!-- changelog:start -->` and `<!-- changelog:end -->`. The rest is a review of public API
changes for you, and the release doesn't publish it. After you confirm, the script runs:

```sh
gh workflow run release.yml --ref main -f bump=<bump> -f release_notes=<notes>
```

With a version instead of a bump, it passes `-f version=<version>`.

To write the notes to stdout and stop, run `pnpm release --print`. It works with unpushed
commits.

`.github/workflows/release.yml` then does the following:

1. Resolves the version. It uses `version` as given, or else the latest stable tag plus `bump`.
2. For a stable version, it commits `release: v<version> [skip ci]` on top of the commit the run
   started from and pushes it to `main`. The commit sets the version in every release package.
   When the run has release notes, the commit also adds them to the top of `CHANGELOG.md` under
   a `## v<version>` heading with the date. If `main` moved in the meantime, the push fails.
   Start the release again.
3. Checks out that commit and checks that the release packages share one version. It stops if a
   signing secret or an account variable is empty. Then it builds the web app and canvas bundles
   once, for every desktop target to share.
4. Builds the `nyte` binaries and the desktop app for every target in `scripts/release-targets.mjs`,
   each on its own Blacksmith runner. It signs and notarizes the macOS binaries. With
   `platforms: darwin` it builds Apple silicon macOS alone, as nightlies do. At the same time, it
   runs format, lint, typecheck, build, tests, `sdk:check`, `sdk:pack` and `sdk:verify` on a
   GitHub-hosted Linux runner, unless `skip_verify` is set.
5. Once those pass, uploads the binaries and the desktop app to a draft GitHub release `v<version>`.
6. Tags the release commit `v<version>` and publishes the GitHub release. The body is the reviewed
   notes when given, and generated notes otherwise. The desktop updater picks up the release from
   here.
7. Publishes the SDK packages to npm with `pnpm release:publish`, which builds them and runs
   `pnpm -r publish` in dependency order, with provenance.
8. Publishes `nyte-ai` last. The GitHub release is public by then, so the launcher never points at
   assets that a draft still hides.

For a stable release, `v<version>` names the commit whose package manifests say `<version>`.

Versions with a `-` are prereleases and skip step 2. They build the commit the run started from,
write the version into the manifests only at publish time, and tag that commit. They publish as a
GitHub prerelease. Nightlies publish to the npm `nightly` dist-tag, other prereleases to `next`,
and stable releases to `latest`. `nyte update` and the desktop updater follow the installation's
channel, which is stable unless the user switched to nightly.

You can run every step again. Step 2 reuses the commit the `v<version>` tag names, or else the
`release: v<version> [skip ci]` commit on `main`, so a rerun never makes a second one.
`pnpm -r publish` skips versions npm already has, and the tag and release steps check what
exists. To resume a failed run, re-run it from the Actions page, or start **Release** by hand
with `version` set. A new run with only `bump` picks the same version until the tag exists, and
the next version after that.

Nightly builds go through the same workflow. See
[Nightly releases](scripts/README.md#nightly-releases).

To build the Mac desktop app without Actions or publication, see
[Build desktop assets on another OS](scripts/README.md#build-desktop-assets-on-another-os).

## Continuous integration

CI runs `sdk:check`, format, lint, typecheck and `operations` on every pull request and on every
push to `main` and `release/**`. A push to `main` runs these checks alone.

Pull requests and pushes to `release/**` also test the affected packages. They run unit tests on
Linux, build and test the compiled `nyte` binary, and run `sdk:pack` and `sdk:verify`
when the SDK changed. They run the web and desktop end-to-end tests when the app or the desktop
package changed. Pushes to `release/**` also run unit tests on macOS.

The daily scheduled run and a manual run test every package, on macOS as well. For a native
check on one OS, start **Test on one OS** by hand.

## One-time setup

- **npm trusted publishing.** On npmjs.com, open the settings of each package: `@nyte-ai/schema`,
  `@nyte-ai/ai`, `@nyte-ai/core`, `@nyte-ai/plugin`, `@nyte-ai/protocol`, `@nyte-ai/host`,
  `@nyte-ai/sdk` and `nyte-ai`. Keep two GitHub Actions trusted publishers for
  `interfaces-lab/nyte`, `release.yml` for releases and `nightly.yml` for nightlies. npm checks
  the workflow that started the run, which for a nightly is `nightly.yml` even though
  `release.yml` publishes. npm accepts trusted publishing only from GitHub-hosted runners, so the
  publish job runs on `ubuntu-latest`.
- **First publish of a new package.** npm configures trusted publishers only on a package that
  exists. For a new package's first release, add a granular `NPM_TOKEN` repository secret that can
  publish to the `@nyte-ai` scope. The publish job uses it when it is set. Configure the trusted
  publishers afterwards, then delete the secret.
- **GitHub App for the commit to `main`.** `main` is protected, so the workflow's own token can't
  push to it. Create a GitHub App owned by `interfaces-lab` with **Contents: Read and write**,
  install it on `interfaces-lab/nyte` only, and add it to the bypass list of the `main` ruleset or
  branch protection. Save its App ID as the `RELEASE_APP_ID` repository variable and a private key
  as the `RELEASE_APP_PRIVATE_KEY` repository secret.
- **Other secrets and variables.** The release workflow also needs the `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and
  `CENTRAL_LICENSE_KEY` secrets, and the `NYTE_CONNECT_ORIGIN`, `NYTE_CLERK_PUBLISHABLE_KEY` and
  `NYTE_CLERK_FRONTEND_API_HOST` variables. Without the signing secrets or the account variables,
  step 3 stops the release.
