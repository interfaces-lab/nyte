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
| `@nyte-ai/host` | Model, plugin, and workspace composition |
| `@nyte-ai/server` | Authenticated HTTP calls and SSE watches |
| `@nyte-ai/client` | Browser-safe fetch client, observer, outbox, and projections |
| `@nyte-ai/plugin` | Supplied plugins, MCP, and codemode |
| `@nyte-ai/protocol` | SDK wire operations and schemas |
| `@nyte-ai/schema` | Shared message, model, and tool types |
| `@nyte-ai/telemetry` | Instrumentation contracts and OpenTelemetry adapter |

The nine SDK packages share the CLI release version. Their `workspace:*`
dependencies become exact versions when pnpm packs them. The first prerelease
uses the `next` dist-tag. Node hosts require Node 26.4 or later; `client`,
`protocol`, and `schema` also run in browsers. The supplied plugin package
currently brings OpenTUI as a dependency, including for headless hosts.

## Private

| Package directories | Reason |
| --- | --- |
| `app`, `desktop`, `tui`, `mobile` | Product applications, distributed through their own builds |
| `connect`, `connect-worker` | Product connection services |
| `serve` | Product listener and CLI; currently depends on `app` |
| `cloudflare`, `vercel` | Deployment adapters awaiting a separate packaging and runtime verification pass |
| `ui` | Component library awaiting a separate release |
| `docs`, `lab`, `demo`, `demo/website`, `demo/server/*` | Site, experiments, and examples |

Use public `server` with a Node adapter when building a custom web app. Do not
publish `app` just to make the current `serve` package installable.

## Build and pack

Use the runtimes in `mise.toml`. These commands do not publish:

```sh
pnpm sdk:check
pnpm sdk:pack
pnpm sdk:verify
```

`check` rejects missing visibility, version mismatches, and public packages with
private production dependencies. `pack` builds dependencies before dependents:

1. TypeScript emits declarations.
2. Bun builds ESM JavaScript with external package dependencies and shared chunks.
   All source modules are entrypoints, including worker and lazy-loaded modules.
3. The script temporarily changes source exports to `types` and `import` entries
   in `dist` and copies the license files into the package, runs `pnpm pack`, then
   restores the manifest and removes the copies in `finally`.
4. Tarballs and their publication order are written to `dist/sdk`.

This follows [OpenCode v2's SDK build and publish scripts](https://github.com/anomalyco/opencode/tree/v2/packages/sdk/script).
Nyte uses pnpm to pack its pnpm workspace. Workspace development continues to
resolve TypeScript source; consumers get compiled JavaScript and declarations.
Do not use plain `npm publish` inside an SDK source package.

`verify` installs the tarballs into a temporary project outside the workspace.
It must pass before release; checking workspace imports is insufficient because
symlinks can hide missing files and Node's refusal to strip TypeScript inside
`node_modules`.

## Publish

No SDK packages have been published by this change. Before the first release:

- Confirm access to the `@nyte-ai` npm scope and availability of all nine names.
- Configure npm trusted publishing for each package using
  `.github/workflows/sdk-packages.yml` and the `npm-sdk` GitHub environment.
- Protect that environment with release approval. If npm requires an initial
  publication before trusted publishing can be configured, an authorized
  maintainer must bootstrap the verified tarballs with npm credentials.
- Set all public package versions to the intended release and commit the changes.

Run the **SDK packages** workflow without publishing first. It builds, verifies,
and uploads the tarballs. To publish, run it on a matching `v<version>` tag with
`publish` enabled. It publishes the exact verified tarballs in dependency order,
uses `next` for prereleases and `latest` otherwise, and requests npm provenance.
Already-published versions are skipped so a partially completed release can resume.
The CLI launcher's existing release workflow remains separate.
