# Package distribution

The first SDK npm release is being prepared. Public below means intended for npm
publication, not confirmation that a version is already available in the registry.

Every workspace package declares `private` explicitly. Public packages use MIT;
upstream code retains its licenses in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
The SDK tarballs contain `LICENSE` and `THIRD-PARTY-NOTICES.md` at the package root, plus
source-local license files under `dist`. The repository's MIT license does not relicense
third-party assets or dependencies.

## Public

| Package | Purpose |
| --- | --- |
| `nyte-ai` | Existing CLI launcher, published through the app release workflow |
| `@nyte-ai/ai` | Models, providers, credentials, and streaming |
| `@nyte-ai/core` | Agent kernel, sessions, storage, and plugin contracts |
| `@nyte-ai/host` | Node host, listener, stores, and local workspace |
| `@nyte-ai/sdk` | `sdk.open` and `sdk.connect`, one surface in process and over the wire |
| `@nyte-ai/plugin` | Plugin contracts, supplied plugins, MCP, codemode, and renderers |
| `@nyte-ai/protocol` | SDK wire operations and schemas |
| `@nyte-ai/schema` | Shared message, model, and tool types |

The seven SDK packages share the CLI release version. Their `workspace:*`
dependencies become exact versions when pnpm packs them. Prereleases use the
`next` dist-tag. Node hosts require Node 26.4 or later; `sdk` (its
`browser` and `react-native` entry), `core`, `protocol`, and `schema` also run in
browsers. The supplied plugin package declares OpenTUI and React as optional
peers, for its renderers.

## Private

| Package directories | Reason |
| --- | --- |
| `app`, `desktop`, `tui`, `mobile` | Product applications, distributed through their own builds |
| `connect`, `connect-worker` | Product connection services |
| `bench` | Test fixtures: scripted models, cassettes, scenarios, and the host simulation |
| `ui` | Component library awaiting a separate release |
| `docs`, `lab`, `examples/*` | Site, experiments, and examples |

Use `@nyte-ai/sdk` when building a custom web app: `sdk.open` and `host.listen`
serve it, and `sdk.connect` reaches it from the browser.

## Build and pack

Use the runtimes in `mise.toml`. These commands do not publish:

```sh
pnpm sdk:check
pnpm sdk:pack
pnpm sdk:verify
```

`check` rejects missing visibility, public packages without MIT, public access or provenance,
public packages with private production dependencies, and a `publishConfig.exports` that does
not map each source export into `dist`. Each package's `build:package` task, which Turborepo
runs dependencies first, does the build:

1. TypeScript emits declarations.
2. Bun builds ESM JavaScript with external package dependencies and shared chunks.
   All source modules are entrypoints, including worker and lazy-loaded modules.
3. The root `LICENSE` and `THIRD-PARTY-NOTICES.md` are copied into the package.

`pack` runs that task and `pnpm pack` into `dist/sdk`. pnpm swaps in `publishConfig.exports`
and turns `workspace:*` into exact versions. Workspace development keeps resolving TypeScript
source; consumers get compiled JavaScript and declarations. Publish with pnpm only: npm
ignores `publishConfig.exports` and would ship the source exports.

`verify` installs the tarballs from `dist/sdk`, or from the directory it is given, into a
temporary project outside the workspace. It must pass before release; checking workspace
imports is insufficient because symlinks can hide missing files and Node's refusal to strip
TypeScript inside `node_modules`.

## Publish

[RELEASING.md](RELEASING.md) covers versioning, the release workflow, and the one-time npm setup.
