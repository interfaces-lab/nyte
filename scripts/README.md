# Release assembly

`install-nyte.sh` (`pnpm install:nyte` from the root) copies `packages/tui/dist/nyte` to
`~/.nyte/bin/nyte`. Builds leave the installed binary alone; packaging runs this installer.
Put `~/.nyte/bin` first on your PATH so another installation does not shadow it.

`package.sh` (`pnpm package:tui` from the root) builds and signs through `pnpm build` in `packages/tui`, then
calls `assemble-release.sh` on `packages/tui/dist/nyte`. The assembly step only copies an existing executable,
copies `packages/cli/docs`, writes `VERSION`, and creates the tarball and SHA-256
file, then installs the built binary at `~/.nyte/bin/nyte`. CLI and TUI package versions must match.
It never downloads or publishes.

## Delegate a Mac desktop build

Run this from a Linux clone after committing and pushing the approved source:

```sh
export NYTE_CONNECT_ORIGIN=https://connect.example.com
export NYTE_CLERK_PUBLISHABLE_KEY=pk_live_...
export NYTE_CLERK_FRONTEND_API_HOST=accounts.example.com
bash scripts/build-mac-release.sh nyte-release-mac /Users/build/nyte ./mac-release HEAD
```

`nyte-release-mac` is an SSH alias for a trusted Apple Silicon Mac. Its repository must
have an `origin` that can fetch the approved commit. Both machines need the Node, pnpm
and Bun versions in `mise.toml`; dependency installation may also require
`CENTRAL_LICENSE_KEY`. Use an absolute remote repository path without spaces and a new
local output directory. SSH must work non-interactively with a verified host key.
The command does not forward SSH agents or signing credentials.

On the Mac, create `~/.config/nyte/release.env` with mode `600`. Set the same three
`NYTE_` account values, plus `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. `APPLE_API_KEY` is the absolute path to the
Mac's private `.p8` file. `CSC_LINK` can reference a local signing certificate. Keep
these files outside the repository. Install Apple's command-line tools on the Mac.

The command builds the web app and canvas and runs their tests on Linux in a fresh
worktree at the requested commit. It transfers only their output and a manifest. The
Mac checks the commit, lockfile, public `VITE_` configuration and every file checksum
before importing the assets. Dotenv build files and symlinks are rejected. It then
compiles Electron and the native TUI, builds the DMG and ZIP, and signs and notarizes
them. Signing, stapling, Gatekeeper and the bundled CLI version are checked before
downloading the release files and their checksums.

Nothing is published, tagged or installed locally. Run the desktop smoke checks before
publishing; this packaging command does not replace the full release test suite. A
failed Mac build keeps its temporary directory for inspection. Remove its worktree
with `git -C /Users/build/nyte worktree remove --force <printed-directory>/source`
and then remove that temporary directory when no build is running there.

The same handoff can be used without SSH, from clean checkouts at the same commit:

```sh
# Linux. The destination must not exist and must be outside the checkout.
node packages/desktop/scripts/assets.mjs build /tmp/nyte-desktop-assets
# Transfer that directory through a trusted channel, then on the target OS:
node packages/desktop/scripts/build.mjs --assets /tmp/nyte-desktop-assets --package --publish never --mac --arm64
```

The release workflow uses this handoff for every desktop target. Only browser assets
are shared; native dependencies, Electron compilation, TUI binaries and caches stay
on their target OS.

## SDK packages

[Package distribution](../PACKAGES.md) declares public and private packages. Run
`pnpm sdk:check`, `pnpm sdk:pack`, then `pnpm sdk:verify` before publishing the SDK.
`sdk-packages.mjs build` builds one package's declarations with TypeScript and its
JavaScript with Bun; Turborepo runs it as `build:package`. [RELEASING.md](../RELEASING.md)
covers publishing.

## Release versions

The release workflow requires every package in the Changesets fixed group to match the
release version and installs dependencies from the frozen lockfile. TUI and desktop bundle
their core and built-in plugins from that checkout; they do not load a separately upgraded
core at runtime.

Pin the app release, not individual internal workspace packages. A plugin loaded from a user
or project directory uses the running host's API. Update that plugin's source with the host
when the plugin API changes; the unreleased API has no compatibility layer. An older app
retains its bundled API, but cannot be assumed to run plugins written for a newer release.

## Archive contents

To inspect assembly with a harmless fixture, without compiling:

```sh
fixture=$(mktemp -d)
version=$(node -p "require('./packages/cli/package.json').version")
printf '#!/bin/sh\nexit 0\n' > "$fixture/nyte"
sh scripts/assemble-release.sh "$fixture/nyte" "$fixture/release" darwin-arm64
tar -tzf "$fixture/release/nyte-v$version-darwin-arm64.tar.gz"
```

The archive name carries the current manifest version. Use the target you need.
The archive layout is:

```text
nyte
VERSION
docs/
  README.md
  examples/
    README.md
    ask.sh
    prompt-file.sh
```

The npm `files` list includes the same `docs` source directly, so no prepack
generation is needed. The npm launcher extracts the native archive in its versioned
cache. `packages/docs/public/install` copies docs into
`<install-directory>/../share/nyte/<version>/docs`.
Older releases without docs still install through the existing binary path.

Run the distribution tests with `pnpm --dir packages/cli test`. They use `npm pack`
offline in a temporary directory to inspect npm's actual file selection, assemble a
fixture native archive through the production script, verify relative links, and
exercise the installer with a local download fixture. No production binary,
provider request, release upload, or signing is involved.
