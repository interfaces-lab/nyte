# Release assembly

`package.sh` (`pnpm package:tui` from the root) builds and signs through `pnpm build` in `packages/tui`, then
calls `assemble-release.sh`. The assembly step only copies an existing executable,
copies `packages/cli/docs`, writes `VERSION`, and creates the tarball and SHA-256
file. CLI and TUI package versions must match. It never downloads or publishes.

To inspect assembly with a harmless fixture, without compiling:

```sh
fixture=$(mktemp -d)
printf '#!/bin/sh\nexit 0\n' > "$fixture/nyte"
sh scripts/assemble-release.sh "$fixture/nyte" "$fixture/release" darwin-arm64
tar -tzf "$fixture/release/nyte-v0.0.2-darwin-arm64.tar.gz"
```

Use the current manifest version in the archive name and the target you need.
The archive layout is:

```text
nyte
VERSION
docs/
  README.md
  usage.md
  examples/
    README.md
    ask.sh
    prompt-file.sh
```

The npm `files` list includes the same `docs` source directly, so no prepack
generation is needed. The npm launcher extracts the native archive in its versioned
cache. `install.sh` copies docs into `<install-directory>/../share/nyte/<version>/docs`.
Older releases without docs still install through the existing binary path.

Run the distribution tests with `pnpm --dir packages/cli test`. They use `npm pack`
offline in a temporary directory to inspect npm's actual file selection, assemble a
fixture native archive through the production script, verify relative links, and
exercise the installer with a local download fixture. No production binary,
provider request, release upload, or signing is involved.
