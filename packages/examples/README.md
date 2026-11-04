# Examples

Small programs built on Nyte's public packages. Each one is a private workspace package.

| Example | What it shows |
| --- | --- |
| [cloudflare](cloudflare/README.md) | One host in a SQLite-backed Durable Object, chat only |
| [vercel](vercel/README.md) | A Nitro app over PostgreSQL, with tools in a sandbox you supply |
| [tui-chat](tui-chat/src/index.tsx) | The smallest terminal chat over `sdk.open` |

The terminal chat runs under Bun and reuses the login from `nyte login`. Sign in first, then run:

```sh
pnpm --dir packages/examples/tui-chat start
```
