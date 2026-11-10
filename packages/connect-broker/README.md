# @nyte-ai/connect-broker

The Nyte Connect broker, a Cloudflare Worker over D1. It links desktops to Clerk accounts, signs the short leases that decide which phones a desktop serves, and relays phone requests to each desktop over a WebSocket the desktop opened. Desktops need no inbound port and no tunnel.

Each linked desktop gets one relay Durable Object, which holds that environment's devices, policy and proofs in its own SQLite. The wire contract lives in [`@nyte-ai/connect`](../connect/README.md), and `packages/connect/src/relay.ts` describes the relay protocol: frames, flow control, close codes and limits. This package implements the broker side.

The broker is served at `https://nyte-connect.daniel-fu90.workers.dev` through `workers_dev`, with no custom domain. Every step under [Operator setup](#operator-setup) is manual.

## Routes

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /v1/environments` | Clerk JWT and a proof by the key being linked | Links a desktop, or resumes and renames the same key's link. |
| `GET /v1/environments` | Clerk JWT | Lists the caller's active environments. |
| `DELETE /v1/environments/:id` | Owner JWT or environment proof | Revokes the environment and closes its relay socket. Answers 204. |
| `POST /v1/environments/:id/lease` | Environment proof, body `{}` | Signs a 60 second allowlist. |
| `GET /v1/environments/:id/relay` | First frame is an environment proof | The desktop's relay WebSocket. |
| `POST /v1/environments/:id/devices` | Owner JWT | Enrolls a phone's token digest through the relay. Answers 201 only once the device is active. |
| `DELETE /v1/environments/:id/devices/:deviceId` | Owner JWT or environment proof | Strong revocation. Also denies and revokes the enrolling Clerk session. Answers 204. |
| `POST /v1/environments/:id/devices/:deviceId/release` | Environment proof only, body exactly `{}` | Weak end. The device stops and its Clerk session is left alone. Answers 204. |
| `POST /v1/link-transactions` | Proof by the key being linked | Opens a link transaction for a host without a browser and answers its code. |
| `POST /v1/link-transactions/lookup` | Clerk JWT | Names the host a code belongs to and its key fingerprint. Creates nothing. |
| `POST /v1/link-transactions/:id/approve`, `/deny` | Clerk JWT | The owner approves or refuses the link. |
| `POST /v1/link-transactions/:id/poll`, `/complete` | Key proof | The host polls, then claims the environment once approved. |
| `DELETE /v1/link-transactions/:id` | Key proof | The host gives up. |
| `POST /r/:id/<operation>` | Active device bearer token | Relays one row of the protocol's declarations table to the desktop's host. |
| `POST /r/:id/.nyte/streams`, `/.nyte/streams/cancel`, `/.nyte/ws/ticket` | Active device bearer token | Relays the host's stream and WebSocket ticket routes. |
| `GET /r/:id/.nyte/ws?ticket=` | none, the ticket authenticates | Relays the host's WebSocket. |
| `GET /r/:id/.nyte/identity`, `GET /r/:id/.nyte/describe` | none | Relays the host's identity challenge and description. The host answers them unauthenticated. |
| `DELETE /r/:id/_nyte/connect/device` | Reserved or active device bearer token | Relays the phone's release of its own credential to the desktop. |
| `POST /v1/clerk/webhook` | Clerk webhook signature | Handles `user.updated` for bans and locks, and `user.deleted`. |
| `GET /.well-known/jwks.json` | none | Publishes the broker's public signing keys. |

Another owner's environment or device answers 404, the same as one that doesn't exist. Under `/r/`, refusals are the host's wire error, `{ code, message, hostId, issues, correlation }`. An offline desktop answers 503 `unavailable`, never an auth error. The broker passes `Authorization`, `Content-Type`, `Accept`, `X-Nyte-Input`, `X-Nyte-Channel` and `X-Nyte-Stream` to the desktop. It returns `Content-Type`, `Cache-Control`, `X-Nyte-Host`, `X-Nyte-Credential`, `X-Nyte-Version`, `X-Nyte-Mime` and `X-Nyte-Channel`, exposed to allowed browser origins. `RELAY_REQUEST_HEADER_NAMES` and `RELAY_RESPONSE_HEADER_NAMES` in `@nyte-ai/connect/relay` hold both lists.

## Browser access

`CONNECT_WEB_ORIGINS` is an explicit comma-separated allowlist of exact canonical origins. Each origin must use HTTPS, except HTTP `localhost` and `127.0.0.1`. Paths, credentials, queries, fragments, noncanonical forms, duplicates and empty entries are invalid. An empty string turns browser access off. The broker fails closed on bad configuration.

The checked-in configuration allows `https://app.nyte.sh`, `http://localhost:5179` and `http://127.0.0.1:5179`, matching the web app's `APP_ORIGINS`. The two dev origins are on in the hosted broker on purpose, so a local web app can reach real linked desktops through the public relay. The broker also trusts other software served at those exact local origins for CORS, but that software still needs Clerk or device bearer authentication.

To keep development out of production, remove both dev entries from `CONNECT_WEB_ORIGINS` and `CLERK_AUTHORIZED_PARTIES`, and put them in a separate development broker's `.dev.vars`. The shared client requires an HTTPS broker origin even during development.

Only these route and method pairs get CORS and unauthenticated OPTIONS preflights:

| Route | Allowed methods |
| --- | --- |
| `/v1/environments` | GET |
| `/v1/environments/:id` | DELETE with owner JWT only |
| `/v1/environments/:id/devices` | POST |
| `/v1/environments/:id/devices/:deviceId` | DELETE with owner JWT only |
| `/v1/link-transactions/lookup` | POST |
| `/v1/link-transactions/:id/approve`, `/deny` | POST |
| `/r/:id/<operation>` | POST, including SSE and octet streams |
| `/r/:id/.nyte/streams`, `/.nyte/streams/cancel`, `/.nyte/ws/ticket` | POST |
| `/r/:id/.nyte/ws?ticket=` | GET |
| `/r/:id/.nyte/identity`, `/r/:id/.nyte/describe` | GET |
| `/r/:id/_nyte/connect/device` | DELETE with device bearer |

- Preflights allow only the `authorization` and `content-type` headers on broker routes. Under `/r/` they also allow `accept`, `x-nyte-input`, `x-nyte-channel` and `x-nyte-stream`. They cache for 600 seconds and advertise methods per route.
- Actual responses, including auth refusals and internal errors, echo the exact allowed origin and include `Vary: Origin`.
- Responses expose `retry-after` and `allow`. Under `/r/` they also expose the relayed response headers listed under [Routes](#routes).
- The broker never sends a wildcard origin or `Access-Control-Allow-Credentials`.
- The broker refuses unlisted origins without CORS headers. Requests without `Origin`, such as native ones, are unaffected.

Desktop linking, leases, relay socket upgrades, machine-key releases, the webhook and JWKS publication get no CORS. The broker refuses browser requests that carry `nyte-proof` without CORS, even on the shared DELETE paths. Before frames reach the desktop, the relay strips `Origin`, cookies, `Referer`, `Sec-Fetch` headers and forwarding headers. Only the request headers listed under [Routes](#routes) remain. The desktop still applies its own Origin, host and bearer checks.

The browser token risks, the required strict CSP and the browser client API are in the [`@nyte-ai/connect` README](../connect/README.md#browser-client). Cloudflare and the broker see all relayed traffic, browser traffic included.

## How it works

### Owners

The broker verifies a Clerk session JWT offline with `CLERK_JWT_KEY`. It then requires all of these:

- `iss` equals `CLERK_ISSUER`.
- `aud` names `CONNECT_ORIGIN`.
- `sid` is not empty.
- `azp`, when present, is in `CLERK_AUTHORIZED_PARTIES`.
- `sts`, when present, is `active`.
- There is no `act` claim.

The `owners` table records what Clerk says. Banned or locked users are `disabled`, and deleted users are `deleted` for good. The broker applies a webhook update only when it is newer than the table's row, by Clerk's `updated_at`. After D1 commits, the broker pushes the standing D1 holds to every relay of the owner. If a relay can't be reached, the delivery fails so Clerk retries it. A ban or lock also ends the owner's open relay channels but keeps every link.

### Owner standing

Linking looks the owner up in the Clerk Backend API. The lookup also supplies the owner label, the first available of primary email, username, name, a session `email` claim and the user id. A banned, locked or unknown user links nothing. While Clerk can't answer, linking answers 503. The lookup records nothing.

Only the webhook and the cron write an owner's standing, and no request waits on Clerk for its answer. Every sweep asks Clerk about each owner who holds an active environment, 100 at a time, applies Clerk's answer as current and pushes it to the owner's relays. So the sweep catches a webhook Clerk stopped retrying within five minutes. The sweep disables a user Clerk doesn't return, but never deletes one. Only the webhook deletes.

### Environments

Each owner has at most three active environments, enforced by one conditional `INSERT`. A revoked row is a tombstone, and its key and id never return. A desktop told `revoked` must generate a new machine key before it links again.

D1 indexes environments by owner, key thumbprint, name and slot. Everything else about an environment lives in its relay, which copies the identity from D1 the first time its desktop or owner reaches it. An environment lists as online while its relay socket is authenticated and its last lease is within 90 seconds. The list asks the owner's relays in parallel.

### Relay

The desktop's first frame proves its machine key for `GET` on its relay route. The relay spends the proof's `jti` in its SQLite before it forwards anything. Unproven sockets close after 5 seconds, and at most four wait at once. A newer proven socket replaces the old one, which closes with code 4409 and resets its channels.

The Worker checks a phone request's route, method, size and bearer shape, and that its `Origin` is absent or allowed. The relay then checks that the bearer's SHA-256 matches an active device of its active environment before it opens a channel. No phone request reads D1. The desktop still checks the digest and its current lease on every request. A phone that disconnects resets its channel. Socket state lives in hibernation attachments, and no credential is stored there.

### Devices

To enroll a device, the relay:

1. Reserves a row.
2. Signs a 60 second grant and sends it down the desktop's socket to `/_nyte/connect/enroll`.
3. Verifies the desktop's signed receipt, which covers the grant id, nonce, device id and digest.
4. Reads D1 for a denial of the enrolling session.
5. With no await in between, compare-and-sets the row active.

The set fails if the device was revoked or released meanwhile, the grant lapsed, the environment or owner stopped being active, or D1 or a strong revocation in this environment denies the session. A reservation that never activates is never in a lease, and the next enrollment revokes it once its grant lapses.

### Leases

The relay answers a lease from its own SQLite, without D1 or Clerk. Every activation, revocation, release, replacement and lifecycle change bumps the environment's `policy` in the same transaction. `policy` starts from the clock when the relay first loads, because a desktop refuses a lease whose policy is lower than one it accepted. `generation` is always 1, because a revoked environment issues no lease.

A lease carries `policy`, `generation`, the proof's `jti` as `req`, and the active device ids, read together. Revocation and release also reset the device's open relay channels at once. When that notice is lost, the 60 second lease is the bound.

### Revocation strengths

`DELETE device` denies the enrolling Clerk session in D1 and asks Clerk to revoke it. In one transaction, the relay ends the device and records the denial it owes D1. It writes the denial before it answers, and answers 500 if D1 refused. Its alarm retries from that outbox.

Removing an environment owes D1 its retired slot the same way, but answers 204 once serving has stopped. Revocation applies even to a device that a release or replacement already ended, and upgrades the reason to `revoked`, so a phone can't race a weak release ahead of it.

A denial lasts until Clerk confirms the revocation, plus 24 hours. The cron retries Clerk with backoff up to 30 times. After that, the denial never lapses. A release never creates or clears a denial.

### Cleanup

The cron runs every five minutes. It expires link transactions, retries pending Clerk session revocations, reconciles owner standing with Clerk, and drops spent link proof ids and rate windows. Each relay drops its own spent proofs as it spends new ones.

### Bounds

| What | Limit |
| --- | --- |
| Broker request body | 16 KiB, 64 KiB for webhooks |
| Enrollment receipt | 16 KiB and 10 seconds |
| Clerk answer | 64 KiB and 3 seconds |
| Relayed body | 8 MiB, in credited 32 KiB chunks |
| Data in flight | 256 KiB per channel and direction |
| Channels | 32 per desktop |

Outbound requests go only to `api.clerk.com`. Fixed windows bound requests:

- In D1, per owner on session routes, in the same batch as the session check.
- In D1, per thumbprint and transaction on link transactions, and per client address only when a link transaction opens.
- In each relay, leases and desktop-signed removals, by counting the proofs it spent.
- In each relay's memory, phone requests.

### Secrets

The Clerk keys, the webhook secret and the broker private keys are Worker secrets. Logs carry ids, statuses and codes only. Cloudflare terminates TLS and the relay reads every frame, so bearer tokens and bodies are visible to it. Nothing is end-to-end encrypted.

## Configuration

`wrangler.jsonc` is the source of truth. The Worker runs on the Workers Free plan on its `workers.dev` subdomain. It uses no zone, DNS record, tunnel or Cloudflare API token.

| Kind | Name | What it holds |
| --- | --- | --- |
| var | `CONNECT_ORIGIN` | The Worker's `workers.dev` origin, `https://nyte-connect.daniel-fu90.workers.dev`. It is also the Clerk `aud` claim. |
| var | `CONNECT_WEB_ORIGINS` | Comma-separated exact canonical browser origins. See [Browser access](#browser-access). |
| var | `CLERK_ISSUER` | The Clerk Frontend API URL, compared exactly to `iss`. |
| var | `CLERK_AUTHORIZED_PARTIES` | Comma-separated `azp` values accepted when present. It must include `nyte-desktop://account`, or the broker refuses desktop links. |
| secret | `CLERK_JWT_KEY` | The Clerk instance's PEM public key, for offline verification. |
| secret | `CLERK_SECRET_KEY` | The Clerk instance's Secret Key, for Backend API calls. |
| secret | `CLERK_WEBHOOK_SIGNING_SECRET` | The webhook endpoint's `whsec_…` secret. |
| secret | `BROKER_SIGNING_KEYS` | A JSON array of Ed25519 private JWKs, each with a `kid`. The first key signs, and every key is published. |
| binding | `DB` | The D1 database, with the migrations in `migrations/`. |
| binding | `RELAY` | The `EnvironmentRelay` Durable Object namespace. It is SQLite-backed, as the Free plan requires. Each object holds one host's socket through the WebSocket Hibernation API and answers pings without waking. |
| cron | `*/5 * * * *` | The sweep under [Cleanup](#cleanup). |

Set secrets with `wrangler secret put <NAME>`. Never commit a value, and never put one in a `vars` block.

### Broker signing keys

Generate a key set:

```sh
node -e 'const { generateKeyPairSync, randomUUID } = require("node:crypto"); const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }); console.log(JSON.stringify([{ ...jwk, kid: randomUUID() }]))'
```

Hosts store the published key set from `/.well-known/jwks.json` when they link, and fetch it again only when a token names an unknown `kid`. To rotate, put the new key first and keep the old one second until no token it signed can still be valid, which takes one minute.

## Operator setup

Run these steps from `packages/connect-broker`. `wrangler` is a dev dependency of this package, so run it through `pnpm exec`.

1. Configure the Clerk instance and its webhook as the [`@nyte-ai/connect` README](../connect/README.md#clerk) describes. Every origin you allow in Clerk must also be in `CLERK_AUTHORIZED_PARTIES` in `wrangler.jsonc`.
2. Check `wrangler.jsonc` before you deploy. It already names the account, the D1 database, the relay Durable Object and the vars. For a new account, create the database and put its id in `wrangler.jsonc`:

   ```sh
   pnpm exec wrangler d1 create nyte-connect
   ```

3. Set each secret from [Configuration](#configuration) with `pnpm exec wrangler secret put <NAME>`.
4. Deploy:

   ```sh
   pnpm run deploy
   ```

`pnpm run deploy` builds the Worker and hashes the bundle, `wrangler.jsonc` and the migrations. When the live version already carries that hash as its tag, it stops. Otherwise it runs the typecheck and tests, applies pending migrations, and deploys with the hash as the tag. The Deploy broker workflow runs it on every push to `main`, with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. A deploy restarts every relay, so desktops reconnect.

A migration and the code that needs it must land together. Between the two, requests that touch the changed tables fail.

For `wrangler dev`, copy `.dev.vars.example` to `.dev.vars`, which git ignores, and fill in the secrets it lists.

## Development

```sh
pnpm --dir packages/connect-broker test
pnpm --dir packages/connect-broker typecheck
```

The tests use real signatures everywhere. Only Clerk's Backend API is fake, and no test reads `.dev.vars`. There are two kinds:

- Most run the broker in Node against a local D1 from wrangler's `getPlatformProxy`, configured by `test/wrangler.jsonc`. They run under a fake `Date`, with each relay's real `EnvironmentRecord` over `node:sqlite` and a fake desktop that answers enrollments.
- The `relay-*.test.ts` files and `host-link.test.ts` run the whole Worker, the relay Durable Object and D1 in local workerd through wrangler's `createTestHarness`, configured by `test/workerd.ts` and `test/workerd.jsonc`, with real WebSockets and HTTP. They cover browser CORS, preflights, HTTP and SSE forwarding, enrollment through a real socket, and native behavior.

When the relay closes a client socket that never sent a frame, local workerd leaves that socket in CLOSING, so the tests observe its close as leaving OPEN. Production doesn't rely on this.
