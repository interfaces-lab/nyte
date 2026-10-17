<p align="center">
  <img alt="Nyte" src="./packages/desktop/build/icon.svg" width="128">
</p>

# Nyte

Nyte is a durable runtime for agent conversations, with terminal and desktop clients.

The clients embed the host, keep sessions in SQLite, and run agents in process. The same kernel serves remote clients via `host.listen` (`@nyte-ai/host`, PostgreSQL) and runs on Cloudflare Durable Objects and Vercel (`@nyte-ai/host/deploy/*`). Clients connect through `@nyte-ai/sdk`. Each step reads all durable state, so any host can take over between steps.

## Install

```sh
curl -fsSL https://nyte.sh/install | sh
nyte login
nyte                     # or: nyte -p "your prompt"
```

See the [user guide](packages/cli/docs/README.md).

## Development

```sh
mise install && pnpm install
pnpm format && pnpm lint && pnpm typecheck
```

- [Build an agent app](packages/docs/content/docs/build/composition.mdx)
- [CONTRIBUTING.md](CONTRIBUTING.md): package map, checks, commits
- [PACKAGES.md](PACKAGES.md): package distribution and npm publishing
- [AGENTS.md](AGENTS.md): agent instructions

MIT [license](LICENSE); upstream licenses in [Third-party notices](THIRD-PARTY-NOTICES.md).
