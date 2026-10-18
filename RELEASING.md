# Releasing

Nyte ships one version. The seven SDK packages, the `nyte-ai` launcher, the TUI and the desktop app
form a Changesets `fixed` group in `.changeset/config.json`, so they always move together. Other
private packages are ignored and never versioned.

## Contributors

Every pull request that changes a released package adds a changeset:

```sh
pnpm changeset
```

Pick the packages and the bump, then write the summary that becomes the changelog entry. Naming
one package bumps the whole group. A change that needs no release gets `pnpm changeset --empty`.
The **Changesets** workflow runs `changeset status` on pull requests and fails when a changed
package has no changeset.

## Maintainers

On every push to `main`, `.github/workflows/changesets.yml` does one of two things:

- With pending changesets, it opens or updates the `chore: version packages` pull request. That
  pull request runs `pnpm version-packages`, which bumps the group and writes each `CHANGELOG.md`.
- With no pending changesets and no published GitHub release for the current version, it calls
  `.github/workflows/release.yml` with that version.

Merging the version pull request ships the release. `release.yml` then:

1. Checks that every package in the fixed group is at the release version, then runs format, lint,
   typecheck, build, tests, `sdk:check`, `sdk:pack` and `sdk:verify`.
2. Builds, signs and notarizes the `nyte` binaries, and builds the desktop app.
3. Uploads both to a draft GitHub release `v<version>`.
4. Publishes the SDK packages to npm with `pnpm -r publish`, in dependency order, with provenance.
5. Pushes the `v<version>` tag and publishes the GitHub release. A version with a `-` becomes a
   prerelease; any other becomes the latest release.
6. Publishes `nyte-ai` last, so the launcher never points at assets a draft still hides.

Versions with a `-` publish to the npm `next` dist-tag, the rest to `latest`. `pnpm -r publish`
skips versions npm already has, so a failed run resumes from where it stopped. To resume or
rerun one, start **Release** by hand with the version, from `main` or from its tag.

### Prereleases

```sh
pnpm changeset pre enter beta
```

Commit `.changeset/pre.json`. Each version pull request then produces `x.y.z-beta.n`, which
ships to npm `next` and as a GitHub prerelease. `nyte update` and the desktop updater ask GitHub
for its latest release, which never points at a prerelease, and npm `latest` stays on the stable
launcher, so stable installs stay stable. Leave with `pnpm changeset pre exit`.

## One-time setup

- **npm trusted publishing.** On npmjs.com, open each package's settings (`@nyte-ai/schema`,
  `@nyte-ai/ai`, `@nyte-ai/core`, `@nyte-ai/plugin`, `@nyte-ai/protocol`, `@nyte-ai/host`,
  `@nyte-ai/sdk` and `nyte-ai`) and add two GitHub Actions trusted publishers for
  `interfaces-lab/nyte`: workflow `changesets.yml`, which npm checks when it calls `release.yml`,
  and workflow `release.yml`, for manual runs. npm accepts trusted publishing only from
  GitHub-hosted runners, so the publish job runs on `ubuntu-latest`.
- **First publish of a new package.** npm configures trusted publishers only on a package that
  exists. For the first release of the SDK packages, add a granular `NPM_TOKEN` repository secret
  that can publish to the `@nyte-ai` scope. The publish job uses it when set. Configure the
  trusted publishers afterwards and delete the secret.
- **Repository settings.** Under Settings, Actions, General, allow GitHub Actions to create and
  approve pull requests, so the workflow can open the version pull request.
- **Existing secrets.** `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER` and `CENTRAL_LICENSE_KEY` stay as they are, along with the
  `NYTE_CONNECT_ORIGIN`, `NYTE_CLERK_PUBLISHABLE_KEY` and `NYTE_CLERK_FRONTEND_API_HOST` variables.

Pull requests opened with the workflow's `GITHUB_TOKEN` do not start other workflows, so CI does
not run on the version pull request. If branch protection requires those checks, give the version
step a GitHub App token through its `github-token` input. The release itself does not need one,
because `changesets.yml` calls `release.yml` directly instead of waiting for a tag push.
