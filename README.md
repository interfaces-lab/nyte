<p align="center">
  <img alt="Nyte" src="./packages/desktop/build/icon.svg" width="128">
</p>

# Nyte

Nyte is a durable runtime for agent conversations, with terminal and desktop clients.

## Local and cloud

Nyte is local-first today: its clients embed the host, store sessions locally, and run agents in process. The kernel also supports long-lived and serverless hosts backed by remote storage. `@nyte-ai/server` exposes the SDK over JSON and server-sent events, but Nyte does not yet ship a hosted cloud service or production remote backend.

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

To run an app first or build your own TUI or editor app, see [Build an agent app](packages/docs/content/docs/composition.mdx).

Build and test individual packages. See [CONTRIBUTING.md](CONTRIBUTING.md) for the package map, checks, and commit conventions, the [Core guide](packages/lab/src/core/guide.tsx) for architecture, and [AGENTS.md](AGENTS.md) for agent instructions.
