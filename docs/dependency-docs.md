# Installed references

## Dependency documentation

```sh
pnpm docs:dep --workspace packages/core typebox
pnpm docs:dep:test
```

The required workspace is the importing directory. Only bare package names and
`@scope/name` are accepted. Discovery follows Node package search directories and
physical package links; it does not crawl all of node_modules, load package entries,
run lifecycle scripts, or read documentation contents.

The module exports `discoverDependencyDocs(packageName, workspaceDirectory)`, returning
a promise of the same JSON report the CLI emits on stdout with exit 0. Failure rejects
in the API; the CLI writes `{ "error": "..." }` to stderr and exits 1.

| Field                              | Meaning                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `requestedName`, `name`, `version` | Requested package and installed manifest identity, including aliases         |
| `workspace`, `packageRoot`         | Physical importer directory and selected package root                        |
| `documents`                        | Existing `{ kind, path, trust: "untrusted-reference" }` records              |
| `types`                            | `{ declaredPath, status }`; only `found` records also have a physical `path` |
| `limitations`                      | Discovery limits as strings                                                  |

Document candidates are root README/AGENTS files, docs, ai-docs, docs/ai-docs, and examples.
AGENTS content is reference material, never instruction authority. Paths that escape the
physical package root or broken nearest packages fail instead of falling back silently.
Missing optional documents are omitted. Type statuses are `found`, `missing`, and
`wildcard-not-expanded`; declarations include types/typings and exports type conditions.
No condition selection, typesVersions, inferred types, recursive index, or wildcard
expansion is provided. The filesystem must remain stable during discovery.

## Installed Nyte docs

The default builtin prompt points to these candidates only for Nyte-specific work:

| Installation     | Candidate index                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| npm `nyte-ai`    | `<resolved package root>/docs/README.md`                                    |
| npm native cache | `<NYTE_BIN_DIR or ~/.nyte/bin>/<version>/docs/README.md`                    |
| Native installer | `<NYTE_INSTALL_DIR or ~/.local/bin>/../share/nyte/<version>/docs/README.md` |

Determine the current installation and version and verify existence before reading.
Custom system-prompt text still replaces the default. No home-directory reads or docs
loading happen at prompt initialization. The accepted packaging fixtures verify actual
packed, cache, and installer paths. Old installations may lack docs; the TUI self-updater
stages the release's docs beside the versioned install root when the archive carries them,
so a version installed before that still has none.

## Core benchmarks

`pnpm test:benchmark` runs the provider-free conformance suite. Run
`pnpm typecheck:benchmark` before collecting measurements with
`pnpm bench:core --suite projections --sizes 100,1000,10000 --samples 3 --warmups 1`.
The runner emits one JSON document; help exits 0, invalid arguments exit 2,
and operation failures exit 1 with diagnostics on stderr.

See the [benchmark guide](../packages/core/benchmark/README.md) for fixtures,
all-suite commands, and measurement limits. Heap deltas are neither allocation
counts nor retained memory. Watch timings include injected delays. No timing
threshold or benchmark execution was added to the existing package test command.
