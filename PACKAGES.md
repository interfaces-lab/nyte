# Package distribution

Every workspace package declares `private` explicitly. Public packages are published to npm under
the MIT license. Upstream code keeps its own licenses, listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Each SDK tarball contains `LICENSE` and
`THIRD-PARTY-NOTICES.md` at the package root, plus source-local license files under `dist`. The
repository's MIT license does not relicense third-party assets or dependencies.

## Public

| Package | Purpose |
| --- | --- |
| `nyte-ai` | Launcher that installs the `nyte` command |
| `@nyte-ai/ai` | Models, providers, credentials and streaming |
| `@nyte-ai/core` | Agent kernel, sessions and storage |
| `@nyte-ai/host` | Node host, listener, stores and local workspace |
| `@nyte-ai/sdk` | `sdk.open` and `sdk.connect`, one API in process and over the wire |
| `@nyte-ai/plugin` | Plugin contracts, supplied plugins, MCP, codemode and renderers |
| `@nyte-ai/protocol` | SDK wire operations and schemas |
| `@nyte-ai/schema` | Shared message, model and tool types |

The seven SDK packages share the release version with `nyte-ai`. When pnpm packs them, their
`workspace:*` dependencies become exact versions. Prereleases publish to the `next` dist-tag and
nightlies to `nightly`.

Node hosts require Node 26.4 or later. `core`, `protocol`, `schema` and the `browser` and
`react-native` entry of `sdk` also run in browsers. `@nyte-ai/plugin` declares OpenTUI and React
as optional peer dependencies for its renderers.

To build a custom web app, use `@nyte-ai/sdk`. `sdk.open` and `host.listen` serve a host, and
`sdk.connect` reaches it from the browser.

## Private

| Package directories | Reason |
| --- | --- |
| `app`, `desktop`, `tui`, `mobile` | Product applications, distributed through their own builds |
| `service` | The local host process that `nyte host` and the desktop app run |
| `canvas`, `vt` | Inline canvases and terminal emulation, bundled into the applications |
| `connect`, `connect-broker` | Product connection services |
| `tailnet` | The host's embedded Tailscale node, a Go binary built for each platform |
| `bench` | Test fixtures: scripted models, cassettes, scenarios and the host simulation |
| `ui` | Component library, not published |
| `docs`, `lab`, `examples/*` | Site, experiments and examples |

## Build and pack

Use the runtimes in `mise.toml`. These commands don't publish:

```sh
pnpm sdk:check
pnpm sdk:pack
pnpm sdk:verify
```

`sdk:check` fails when a package:

- doesn't declare `private`
- is public without MIT, public npm access or provenance
- is public but missing from `release.packages` in the root `package.json`, or lacks
  `repository.directory`
- is public and has a private production dependency, or a `workspace:` dependency that isn't in
  the workspace
- is an SDK package that doesn't publish `dist`, or has a `publishConfig.exports` that doesn't
  map each source export into `dist`

Each package's `build:package` task does the build. Turborepo runs it for dependencies first:

1. TypeScript emits declarations.
2. Bun builds ESM JavaScript with external package dependencies and shared chunks. Every source
   module is an entrypoint, including worker and lazy-loaded modules.
3. The task copies the root `LICENSE` and `THIRD-PARTY-NOTICES.md` into the package.

`sdk:pack` runs that task, then `pnpm pack` into `dist/sdk`. pnpm swaps in `publishConfig.exports`
and turns `workspace:*` into exact versions. Workspace development keeps resolving TypeScript
source, and consumers get compiled JavaScript and declarations. Publish with pnpm only. npm
ignores `publishConfig.exports` and would ship the source exports.

`sdk:verify` installs the tarballs from `dist/sdk`, or from the directory you pass it, into a
temporary project outside the workspace. It must pass before a release. Checking workspace
imports isn't enough, because symlinks can hide missing files and Node won't strip TypeScript
inside `node_modules`.

## Publish

[RELEASING.md](RELEASING.md) covers versioning, the release workflow and the one-time npm setup.
