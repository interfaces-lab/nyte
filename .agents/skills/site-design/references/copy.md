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
| Built like git: content-addressed objects          | `packages/core/src/kernel/README.md`                     |
| Refs move by compare-and-swap                      | `packages/core/src/kernel/README.md`                     |
| Local sessions in SQLite                           | `packages/core/src/kernel/sqlite.ts`                     |
| Hosted storage in PostgreSQL                       | `@nyte-ai/core/postgres`, kernel README                  |
| Runs on a Cloudflare Durable Object                | `packages/cloudflare/src/index.ts`                       |
| Serves the SDK over Web Request/Response, JSON and SSE | `packages/server/package.json`                        |
| Terminal and desktop clients embed the host        | `README.md`                                              |
| Runs on Vercel                                     | `packages/vercel`, `README.md`                           |
| Desktop app is Apple Silicon only                  | `src/lib/releases.ts` picks `-mac-arm64.dmg`            |
| CLI installs on macOS and Linux, arm64 and x64     | `public/install`                                         |
| Mobile is a companion for a remote Mac host        | `packages/mobile/package.json`                           |
| A session survives the process that started it     | `README.md`, the Design contract in the core guide       |

## Claims to handle with care

- **"At the edge."** Backed by the Cloudflare and Vercel packages and by `README.md`. Nyte still
  does not run a hosted service of its own; say the kernel runs there, not that we host it.
- **"Written by hand."** Removed from the hero; nothing in the repo backs it. Do not reintroduce.
- **Mobile.** It is a companion to a Mac host, not a standalone host. Do not say "runs on your
  phone".
- **Packages are private.** Do not tell visitors to `npm install` a package that is not published.
