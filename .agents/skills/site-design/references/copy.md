# Copy

Run `clean-copy` first (should this sentence exist) and `unslop` last (how it reads). This file
adds only what is specific to Nyte's site: shapes, and which claims are true.

## Shape

- Headline: a promise in four words or fewer. "Agent, deploy anywhere."
- Subhead: one or two sentences, one idea each, about 150 characters in total.
- Do not enumerate platforms or features. The preview already lists the hosts. Keep two or three
  words and make them fact words.
- A fact pill is a noun phrase the visitor can check: "SQLite", not "Fast local storage".

## Claims and their sources

A claim ships only if a source below backs it. Add a row when you verify a new one.

| Claim                                              | Source                                                   |
| -------------------------------------------------- | -------------------------------------------------------- |
| Built like git: content-addressed objects          | `packages/core/README.md`, `packages/core/src/content.ts` |
| Refs move by compare-and-swap                      | `packages/core/src/store.ts` (`RefStore.set`)            |
| Local sessions in SQLite                           | `packages/host/src/sqlite.ts`                            |
| Hosted storage in PostgreSQL                       | `packages/host/src/postgres.ts`                          |
| Runs on a Cloudflare Durable Object                | `packages/host/src/deploy/cloudflare/worker.ts`          |
| Serves the SDK over Web Request/Response, JSON and SSE | `packages/protocol/README.md`, `packages/host/README.md` |
| Terminal and desktop clients embed the host        | `README.md`                                              |
| Runs on Vercel                                     | `packages/host/src/deploy/vercel`, `README.md`           |
| Desktop app is Apple Silicon only                  | `packages/docs/src/lib/releases.ts` picks `-mac-arm64.dmg` |
| CLI installs on macOS and Linux, arm64 and x64     | `public/install`                                         |
| Mobile is a companion for a remote Mac host        | `packages/mobile/package.json`                           |
| A session survives the process that started it     | `README.md`, `packages/core/README.md`                   |

## Claims to handle with care

- **"At the edge."** Backed by `packages/host/src/deploy` and by `README.md`. Nyte still
  does not run a hosted service of its own; say the kernel runs there, not that we host it.
- **"Written by hand."** Removed from the hero; nothing in the repo backs it. Do not reintroduce.
- **Mobile.** It is a companion to a Mac host, not a standalone host. Do not say "runs on your
  phone".
- **Packages are private.** Do not tell visitors to `npm install` a package that is not published.
