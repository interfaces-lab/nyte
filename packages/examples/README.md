# Examples

Small programs built on Nyte's public packages. Each one is a private workspace package.

| Example | What it shows |
| --- | --- |
| [cloudflare](cloudflare/README.md) | One host in a SQLite-backed Durable Object, chat only |
| [vercel](vercel/README.md) | A Nitro app over PostgreSQL, with tools in a sandbox you supply |
| [tui-chat](tui-chat/src/index.tsx) | The smallest terminal chat over `sdk.open` |
| [plan-mode](plan-mode/index.ts) | A composer mode as a folder plugin: a plan file, a card with a Build button, and a tray |
| [ask-mode](ask-mode/index.ts) | A composer mode in one file that refuses edits and commands while it's on |
| [multitask-mode](multitask-mode/index.ts) | A composer mode that is only instructions: run the work in parallel subagents |

The terminal chat runs under Bun and reuses the login from `nyte login`. Sign in first, then run:

```sh
pnpm --dir packages/examples/tui-chat start
```

To use a mode example, copy its folder into `~/.nyte/plugins`. `ask-mode` and `multitask-mode` only import types, so they run as they are. `plan-mode` imports packages at run time, and its `package.json` points at this repository's workspace. In the copied folder, delete `package.json`, `tsconfig.json` and `test`, then run:

```sh
npm install @nyte-ai/core @nyte-ai/schema typebox
```
