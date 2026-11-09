# Release assembly

These scripts build, package and install the `nyte` binary and the desktop app.

## Install a local build

`install-nyte.sh` copies `packages/tui/dist/nyte` and `packages/tui/dist/nyte-tailnet` to
`~/.nyte/bin`. To build the TUI and install it, run this from the root:

```sh
pnpm install:tui
```

Other builds and packaging leave the installed binary alone. Put `~/.nyte/bin`
first on your `PATH` so another installation doesn't shadow it.

`pnpm install:desktop` updates the installed desktop app to a build of the checkout through its
own updater. [Desktop updates](../packages/desktop/UPDATES.md#install-a-local-build) explains
how.

## Package the terminal client

```sh
pnpm package:tui
```

`package.sh` builds the binary through `pnpm build` in `packages/tui`, which ad-hoc signs it on
macOS. Then it calls `assemble-release.sh` on `packages/tui/dist/nyte`. The assembly step copies
the existing executable, `nyte-tailnet` and `packages/cli/docs`, writes `VERSION`, and creates
`dist/nyte-v<version>-<target>.tar.gz` with a `.sha256` file beside it. It never downloads or
publishes. The CLI and TUI package versions must match.

`release-targets.mjs` lists the platforms Nyte ships. The `nyte` binary ships for `darwin-arm64`,
`linux-x64` and `linux-arm64`. The desktop app ships for macOS and Linux x64. Releases don't
include Windows, and a Windows desktop app already installed keeps the version it has.
`pnpm package` builds only the target of the machine it runs on. `package.sh` asks
`release-targets.mjs` for the binary's target, and the desktop build adds the machine's platform
flags unless you pass one. No Intel build ships, so an Intel Mac or a shell under Rosetta stops
with an error. The release workflow builds its matrices from the same list, each target on its own
Blacksmith runner.

## Nightly releases

The **Nightly** workflow runs hourly and builds `main` when it has moved since the latest `v*`
tag, nightly or stable. Start it by hand to build `main` anyway, or the tip of another branch. It
derives a version such as `0.0.25-nightly.20261023.123` from the patch after the latest stable
tag, the UTC date and the run number. It builds Apple silicon macOS only, skips the quality checks
and tests, and publishes a GitHub prerelease and npm's `nightly` tag. Checked-in package versions stay as they
are, and stable installations keep following stable releases.

To follow nightlies in the desktop app, open **Settings > Developer**, turn on **Developer Mode**,
and set **Update channel** to **Nightly**. On that channel, Nyte checks for updates 30 seconds
after startup and then hourly, downloads them in the background and installs them when you quit.
**Restart to Update** installs sooner. Choose **Stable** to return to stable releases. The setting
applies to this installation only.

You can also download a nightly installer from GitHub Releases. To run a nightly terminal client
once, run:

```sh
pnpm dlx nyte-ai@nightly
```

To switch an installed terminal client to nightlies, and back to stable, run:

```sh
nyte update nightly
nyte update stable
```

`nyte update stable` installs the newest stable release even when it is older than the installed
nightly. Afterwards the client follows the channel it switched to. The desktop setting doesn't
change the terminal client.

To package a nightly locally, set `NYTE_RELEASE_VERSION` to a nightly version before you run the
packaging command. It sets the desktop package, bundled CLI and release archive versions together.

## Build desktop assets on another OS

Build the browser assets once, then package them on each target OS. Use clean checkouts at the
same commit and lockfile, with the same `VITE_` environment variables and no `.env` files in
`packages/app` or `packages/canvas`. The packaging step refuses assets that don't match. The
destination must not exist and must be outside the checkout.

On Linux:

```sh
node packages/desktop/scripts/assets.mjs build /tmp/nyte-desktop-assets
```

Copy that directory to the target OS through a trusted channel, then run:

```sh
node packages/desktop/scripts/build.mjs --assets /tmp/nyte-desktop-assets --package --publish never --mac --arm64
```

The release workflow uses this handoff for every desktop target. Only the browser assets are
shared. Native dependencies, Electron compilation, TUI binaries and caches stay on their target
OS.

## SDK packages

[Package distribution](../PACKAGES.md) declares the public and private packages. Before you
publish the SDK, run:

```sh
pnpm sdk:check
pnpm sdk:pack
pnpm sdk:verify
```

`sdk-packages.mjs build` builds one package's declarations with TypeScript and its JavaScript
with Bun. Turborepo runs it as `build:package`. [RELEASING.md](../RELEASING.md) covers
publishing.

## Release versions

`release.packages` in the root `package.json` lists the packages that share the release version.
`release-version.mjs` resolves that version and writes it into each of them. A stable release
commits the version to `main` before it builds. A prerelease or nightly writes it only at publish
time. The workflow installs dependencies from the frozen lockfile. The TUI and desktop app bundle
their core and built-in plugins from that checkout. They never load a separately upgraded core at
runtime.

Pin the app release, not individual internal workspace packages. A plugin loaded from a user or
project directory uses the running host's API. When the plugin API changes, update that plugin's
source together with the host, because the API has no compatibility layer. An older app keeps its
bundled API, and may not run plugins written for a newer release.

## Archive contents

To inspect the assembly with a harmless fixture, without compiling:

```sh
fixture=$(mktemp -d)
version=$(node -p "require('./packages/cli/package.json').version")
printf '#!/bin/sh\nexit 0\n' > "$fixture/nyte"
cp "$fixture/nyte" "$fixture/nyte-tailnet"
sh scripts/assemble-release.sh "$fixture/nyte" "$fixture/release" darwin-arm64
tar -tzf "$fixture/release/nyte-v$version-darwin-arm64.tar.gz"
```

The archive name carries the manifest version, or `NYTE_RELEASE_VERSION` when it is set. Use the
target you need. The archive layout is:

```text
nyte
nyte-tailnet
VERSION
docs/
  README.md
  examples/
    README.md
    ask.sh
    prompt-file.sh
```

The npm `files` list includes the same `docs` directory, so the package needs no prepack step.
The npm launcher extracts the native archive in its versioned cache. `packages/docs/public/install`
copies the docs into `<install-directory>/../share/nyte/<version>/docs`. Releases without docs
still install the binary.

Run the distribution tests:

```sh
pnpm --dir packages/cli test
```

The tests run `npm pack` offline in a temporary directory to inspect npm's real file selection.
They assemble a fixture native archive through the production script, check relative links, and
run the installer against a local download fixture. They use no production binary, provider
request, release upload or signing.
