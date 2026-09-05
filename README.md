<p align="center">
  <img alt="nyte" src="https://raw.githubusercontent.com/interfaces-lab/nyte/main/packages/docs/public/brand/nyte-icon.svg" width="128">
</p>
<p align="center">
  <a href="https://github.com/interfaces-lab/nyte/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/interfaces-lab/nyte?style=flat-square"></a>
  <a href="https://github.com/interfaces-lab/nyte/releases/latest"><img alt="macOS Apple silicon" src="https://img.shields.io/badge/macOS-Apple_silicon-black?style=flat-square"></a>
</p>

# Nyte

Nyte is a durable runtime for agent conversations, with a terminal client. Sessions
are git-like object stores that survive a crash and resume, an agent loop with tool
calling, provider auth, and the clients that attach to them.

* **[@nyte-ai/core](packages/core)**: the kernel (objects, refs, leases, events over SQLite),
  the agent loop, `createNyte`, plugins, skills, compaction, hooks, and the tools: read, bash,
  edit, write, ls
* **[@nyte-ai/ai](packages/ai)**: unified multi-provider API. OpenAI, Anthropic, Google,
  OpenCode. Credentials, OAuth, event streams
* **[@nyte-ai/schema](packages/schema)**: neutral `Message`, `Model`, `Tool`, and `Skill` contracts
* **[@nyte-ai/plugin](packages/plugin)**: `definePlugin` and the types a plugin file imports
* **[@nyte-ai/tui](packages/tui)**: the `nyte` terminal client. Bun and OpenTUI, with print mode

To learn more, read the [design record](packages/docs/content/docs/design.mdx): the chosen
path, the reasoning, the contracts, and the build order.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/interfaces-lab/nyte/main/install.sh | sh
```

macOS (Apple silicon) binaries are on
[GitHub Releases](https://github.com/interfaces-lab/nyte/releases). The script verifies the sha256
and installs to `~/.local/bin`. Then log in and run:

```sh
nyte login
nyte
```

In the TUI, `/tasks` opens the live subagent and shell-call picker. Press Enter to
inspect output, Escape to return, or Down from an empty composer to open the picker.
The inspector is read-only; stopping a shell call stops its owning run.

Installed copies update themselves with `nyte update`. One prompt without the full screen:

```sh
nyte -p "summarize the files in packages/core/src"
```

## Trust and permissions

Nyte asks once per directory whether you trust it. That is the only permission gate. A trusted
workspace lets the tools read files, run shell commands, and edit code with your process's
access. There are no per-tool prompts. If you need stronger boundaries, containerize or
sandbox the process; nothing in the kernel assumes the host is safe.

## All packages

Library and app packages are private to this workspace. `nyte-ai` on npm installs the native
`nyte` terminal client. "Shipped" means the source is here and runs.

| Package | Description |
| --- | --- |
| **[@nyte-ai/schema](packages/schema)** | Wire contracts: `Message`, `Model`, `Tool`, `Skill` |
| **[@nyte-ai/ai](packages/ai)** | Provider adapters, credentials, OAuth, model catalogs |
| **[@nyte-ai/core](packages/core)** | Kernel, agent loop, SDK, SQLite store, plugins, skills, tools |
| **[@nyte-ai/plugin](packages/plugin)** | Plugin authoring surface; the host lives in core |
| **[@nyte-ai/telemetry](packages/telemetry)** | `TelemetryContext`; the default records nothing |
| **[@nyte-ai/ui](packages/ui)** | Shared Base UI components in StyleX |
| **[@nyte-ai/tui](packages/tui)** | The terminal client, on Bun and OpenTUI |
| **[nyte-ai](packages/cli)** | npm launcher for the native `nyte` terminal client |

## Development

pnpm only. `mise.toml` pins Node 26 and Bun 1.3.14. Keep ripgrep (`rg`) on `PATH`. There is no
grep or find tool. Agents can run any available search command through `bash`; the default prompt
does not prescribe one.

```sh
mise install
pnpm install
pnpm format && pnpm lint && pnpm typecheck
```

Run from source:

```sh
pnpm --dir packages/tui start login
pnpm --dir packages/tui start
```

The docs site lives in [packages/docs](packages/docs):

```sh
cd packages/docs && pnpm dev    # http://localhost:3000
```

When a page and the source disagree, the source wins.
