<p align="center">
  <img alt="Nyte" src="./packages/desktop/build/icon.svg" width="128">
</p>

# Nyte

Nyte is a durable runtime for agent conversations, with a terminal client and a desktop app.

## Install

| Platform | Terminal client | Desktop app |
| --- | --- | --- |
| macOS, Apple silicon | Yes | Yes |
| Linux x64 | Yes | Yes |
| Linux arm64 | Yes | No |
| Windows | Not yet | Not yet |

New releases don't include Windows. A Windows desktop app you already installed keeps running the version it has.

Install the terminal client:

```sh
curl -fsSL https://nyte.sh/install | sh
```

For the desktop app, download it from the [installation guide](https://nyte.sh/docs).

## First run

Sign in to a model provider, then start a session in the folder you want the agent to work in:

```sh
nyte login
nyte
```

To run one prompt and print the answer:

```sh
nyte -p "Summarize this project's README"
```

If something doesn't work, `nyte doctor` checks the install and `nyte triage` starts an agent on what `nyte doctor` finds. The [user guide](packages/cli/docs/README.md) covers the rest.

## How it works

A host is the process that runs the agent and stores sessions. Each client talks to a host on your machine, which keeps sessions in SQLite and runs agents in process. Every step reads its state from the store, so any host can take over a session between steps.

You can also run a host for remote clients with `@nyte-ai/host`, storing sessions in SQLite or PostgreSQL. It runs in a Cloudflare Durable Object and on Vercel, and the [examples](packages/examples) show both. Clients connect through `@nyte-ai/sdk`.

## Development

On macOS or Ubuntu with Node installed, set up a checkout in `./nyte` and start the terminal client:

```sh
npx nyte-ai init
cd nyte
pnpm dev:tui
```

Before you commit, run the checks:

```sh
pnpm check
```

- [Build an agent app](packages/docs/content/docs/build/composition.mdx) in the web framework you already use.
- [CONTRIBUTING.md](CONTRIBUTING.md) covers the package map, checks and commits.
- [PACKAGES.md](PACKAGES.md) covers package distribution and npm publishing.
- [AGENTS.md](AGENTS.md) holds the instructions for coding agents.

## License

MIT. See [LICENSE](LICENSE) and the upstream licenses in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
