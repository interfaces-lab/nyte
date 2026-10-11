<p align="center">
  <img alt="Nyte" src="./packages/desktop/build/icon.svg" width="128">
</p>

# Nyte

Nyte is a durable runtime for agent conversations, with terminal and desktop clients.

## Hosts

The terminal and desktop clients embed the host, store sessions in SQLite, and run agents in process. The same kernel serves remote clients through `host.listen` (`@nyte-ai/host`, over Web Request/Response, with PostgreSQL storage) and runs in serverless hosts: a Cloudflare Durable Object (`@nyte-ai/host/deploy/cloudflare`) and Vercel (`@nyte-ai/host/deploy/vercel`). Clients reach any of them through `@nyte-ai/sdk`. A step reads all durable state, so any host can take over a head between two steps.

## Install

```sh
curl -fsSL https://nyte.sh/install | sh
nyte login
nyte
```

Run one prompt with `nyte -p "your prompt"`. See the [user guide](packages/cli/docs/README.md) for commands and configuration.

## Development

```sh
mise install
pnpm install
pnpm format
pnpm lint
pnpm typecheck
```

To run an app first or build your own TUI or editor app, see [Build an agent app](packages/docs/content/docs/build/composition.mdx).

See [Package distribution](PACKAGES.md) for public and private packages, SDK tarball checks, and npm publishing. Nyte's code uses the [MIT license](LICENSE); upstream licenses remain in [Third-party notices](THIRD-PARTY-NOTICES.md).

Build and test individual packages. See [CONTRIBUTING.md](CONTRIBUTING.md) for the package map, checks, and commit conventions, the [SDK baseline](packages/lab/sdk-shape.ts) for architecture, and [AGENTS.md](AGENTS.md) for agent instructions.
