# Cloudflare

Runs one Nyte host in one SQLite-backed Durable Object, `NyteHost`, behind a Worker that sends every request to it. The host serves a chat-only workspace with no files and no processes.

## Deploy

Run these from `packages/examples/cloudflare`. Give `NYTE_TOKEN` at least 16 characters. `mise install` puts `wrangler` on your `PATH`.

```sh
wrangler secret put NYTE_TOKEN
wrangler secret put NYTE_SECRET_KEY
wrangler secret put NYTE_IDENTITY_KEY
wrangler deploy
```

| Secret | Required | What it does |
| --- | --- | --- |
| `NYTE_TOKEN` | Yes | The token clients send as `Authorization: Bearer <token>` |
| `NYTE_SECRET_KEY` | No | A base64 32-byte key that encrypts stored secrets. Without it, model provider sign-ins and a plugin's `secrets.set` fail. |
| `NYTE_IDENTITY_KEY` | No | A base64 32-byte Ed25519 seed for identity challenges. Without it, `/.nyte/identity` answers `unknown`. |

## How it works

- The object keeps sessions in its own storage through `durableObjectStore` and answers the protocol through `listenFetch`.
- The object runs sessions from its alarm. Each pass advances up to 32 due heads within 10 seconds. When due heads remain, the object sets the alarm again at once. Otherwise it sets the alarm for the next due head in its `nyte_schedule` table, or clears it when no head is due.
- `worker.ts` imports only the node-free subpaths of `@nyte-ai/host`, never its Node root.

## Development

```sh
pnpm --dir packages/examples/cloudflare test
pnpm --dir packages/examples/cloudflare typecheck
```
