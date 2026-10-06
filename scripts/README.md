# Release assembly

`package.sh` (`pnpm package:tui` from the root) builds and signs through `pnpm build` in `packages/tui`, then
calls `assemble-release.sh`. The assembly step only copies an existing executable,
copies `packages/cli/docs`, writes `VERSION`, and creates the tarball and SHA-256
file. CLI and TUI package versions must match. It never downloads or publishes.

## SDK packages

[Package distribution](../PACKAGES.md) declares public and private packages. Run
`pnpm sdk:check`, `pnpm sdk:pack`, then `pnpm sdk:verify` before publishing the SDK.
The separate SDK workflow builds declarations with TypeScript, JavaScript with Bun,
and publishes the verified pnpm tarballs. It does not publish by default.

## Release versions

The release workflow requires CLI, TUI, and desktop versions to match the release tag and
installs dependencies from the frozen lockfile. TUI and desktop bundle their core and built-in
plugins from that checkout; they do not load a separately upgraded core at runtime.

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
  usage.md
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

## Tool settlement migration

Stop all Nyte processes, including desktop, CLI, and background runners. Use Node 26
and install this checkout's dependencies with pnpm. The script reads the current
schemas from this checkout. It does not add reader compatibility or change the
SQLite schema version.

```sh
# Read-only dry run, with an explicit database path.
node scripts/migrate-tool-settlements.mjs /path/to/sessions.db

# Back up with SQLite, then apply in one transaction.
node scripts/migrate-tool-settlements.mjs --apply /path/to/sessions.db
```

This renames `outcome` to `settlement` on tool-result commits and result effects.
Assistant commit outcomes stay unchanged. It rehashes affected objects and their
transitive dependents, including cross-session continuation and completion
references, delegation and job blobs, ref targets, ID-bearing delegation and
cancellation ref names, historical ref events, and expired lease names. Message
content, tool arguments/results, plugin facts, tree IDs, and run IDs stay unchanged.
Compaction blobs contain lease identity, not object references.

Only SQLite schema version 4 with the current tables is supported. The script
streams stored bodies for hash checks and uses SQL to extract reference metadata.
It loads complete JSON only for affected objects, then checks canonical bodies and
current schemas. It also checks name collisions and SQLite integrity. It refuses
unexpired leases, conflicting settlement fields,
ambiguous blob ownership, and unowned delegation/job blobs whose changed references
cannot be resolved safely. Unreferenced delegation snapshots can use a uniquely
matching referenced sibling with the same session, run, call, head, timestamp, and
answer request to resolve the child session. Unchanged older jobs stay unchanged.
An affected job in an older format needs a separate job-format migration first.
Missing historical targets that were garbage-collected stay missing.

Dry runs write nothing. Apply prints the backup path before writing and retains it
in a private directory beside the database. If the database changes during backup
or before the write lock, apply aborts. Failures inside the transaction roll back.
A second successful run is a no-op.

To restore, stop all Nyte processes and close database connections. Keep a copy of
the failed database, remove its `-wal` and `-shm` sidecars, and replace the database
with the printed backup's `sessions.db`. Do not restore while Nyte is running.
