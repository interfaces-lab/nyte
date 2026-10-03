# @nyte-ai/connect-worker

The Nyte Connect broker: a Cloudflare Worker over D1 with one relay Durable Object per linked desktop. It links desktops to Clerk accounts, signs the short leases that decide which phones a desktop serves, and relays phone requests to each desktop over a WebSocket the desktop opened. Desktops need no inbound port and no tunnel. The wire contract lives in `@nyte-ai/connect`; the relay protocol (frames, flow control, close codes, limits) is described in `packages/connect/src/relay.ts`. This package implements the broker side.

It is served at `https://nyte-connect.daniel-fu90.workers.dev` (`workers_dev`, no custom domain). Every step under [Operator setup](#operator-setup) is manual.

## Routes

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /v1/environments` | Clerk JWT and a proof by the key being linked | Links a desktop, or resumes and renames the same key's link. |
| `GET /v1/environments` | Clerk JWT | The caller's active environments. |
| `DELETE /v1/environments/:id` | Owner JWT or environment proof | Revokes the environment and closes its relay socket. 204. |
| `POST /v1/environments/:id/lease` | Environment proof, body `{}` | Signs a 60 second allowlist. |
| `GET /v1/environments/:id/relay` | First frame: environment proof | The desktop's relay WebSocket. |
| `POST /v1/environments/:id/devices` | Owner JWT | Enrolls a phone's token digest through the relay. 201 only once the device is active. |
| `DELETE /v1/environments/:id/devices/:deviceId` | Owner JWT or environment proof | Strong revocation: also denies and revokes the enrolling Clerk session. 204. |
| `POST /v1/environments/:id/devices/:deviceId/release` | Environment proof only, body exactly `{}` | Weak end: the device stops, its Clerk session is left alone. 204. |
| `GET, POST /r/:id/v1/...` | Active device bearer token | Relayed to the desktop's Nyte server. |
| `DELETE /r/:id/_nyte/connect/device` | Reserved or active device bearer token | The phone drops its own credential, relayed to the desktop. |
| `POST /v1/clerk/webhook` | Clerk webhook signature | `user.updated` (banned, locked) and `user.deleted`. |
| `GET /.well-known/jwks.json` | none | The broker's public signing keys. |

Another owner's environment or device answers 404, the same as one that does not exist. Under `/r/`, refusals use the Nyte server's error envelope (`{ ok: false, error }`), and an offline desktop answers 503 `closed`, never an auth error.

## How it holds together

**Owners.** A Clerk session JWT is verified offline with `CLERK_JWT_KEY`. The broker then requires `iss` to equal `CLERK_ISSUER`, `aud` to name `CONNECT_ORIGIN`, a non-empty `sid`, an `azp` from `CLERK_AUTHORIZED_PARTIES` when one is present, no `sts` other than `active`, and no `act` claim. The `owners` table records what Clerk says: banned or locked users are `disabled`, deleted users are `deleted` for good. Webhook updates apply only when newer than what the table holds, by Clerk's `updated_at`. A ban or lock also ends the owner's open relay channels; it keeps every link.

**Owner freshness.** Linking looks the owner up in the Clerk Backend API, which also supplies the owner label (primary email, then username, then name, then a session `email` claim, then the user id). A lease asks Clerk again once the last answered lookup is 15 minutes old. If Clerk does not answer, the stored standing keeps serving until that lookup is 60 minutes old; after that leases answer 503 until Clerk answers. A user Clerk reports as unknown is disabled but not deleted. Only the webhook deletes.

**Environments.** At most three active environments per owner, enforced by one conditional `INSERT`. A revoked row is a tombstone: its key and id never return. A desktop told `revoked` must generate a new machine key before it links again. An environment lists as online while its relay socket is authenticated and its last lease is within 90 seconds.

**Relay.** The desktop's first frame proves its machine key for `GET` on its relay route; the proof's `jti` is spent in D1 before anything is forwarded. Unproven sockets close after 5 seconds, at most four wait at once, and a newer proven socket replaces the old one (close 4409, its channels reset). A phone request is checked for route, method, no browser `Origin`, size, and a bearer whose SHA-256 matches an active device of an active environment, before the relay opens a channel. The desktop still checks the digest and its current lease on every request. A phone that disconnects resets its channel. Socket state lives in hibernation attachments; no credential does.

**Devices.** Enrollment reserves a row, signs a 60 second grant, relays it to the desktop's `/_nyte/connect/enroll`, verifies the desktop's signed receipt (grant id, nonce, device id, digest), and only then compare-and-sets the row active. The set fails if the device was revoked or released meanwhile, the grant lapsed, its Clerk session was denied, or the environment changed generation. A reservation that never activates is never in a lease, and the cron revokes it once its grant lapses.

**Leases.** Every activation, revocation, release, replacement, and lifecycle change bumps the environment's `policy` in the same D1 transaction. A lease carries `policy`, `generation`, the proof's `jti` as `req`, and the active device ids, read in one transaction. Revocation and release also reset the device's open relay channels at once; the 60 second lease remains the bound when that notice is lost.

**Revocation strengths.** `DELETE device` denies the enrolling Clerk session in D1 and asks Clerk to revoke it. It applies even to a device that a release or replacement already ended, upgrading the reason to `revoked`, so a phone cannot race a weak release ahead of it. A denial lasts until Clerk confirms the revocation and 24 hours more. The cron retries Clerk with backoff up to 30 times; past that the denial never lapses. A release never creates or clears a denial.

**Cleanup.** The cron runs every five minutes. It revokes reservations whose grant lapsed, retries pending Clerk session revocations, and drops spent proof ids and rate windows.

**Bounds.** Broker request bodies are capped at 16 KiB (webhooks 64 KiB), enrollment receipts at 16 KiB and 10 seconds, Clerk answers at 64 KiB and 3 seconds. Relayed bodies are capped at 8 MiB and flow in credited 32 KiB chunks, at most 256 KiB in flight per channel and direction, 32 channels per desktop. Outbound requests go only to `api.clerk.com`. D1 counts requests per client address, owner, and environment in fixed windows.

**Secrets.** The Clerk keys, webhook secret, and broker private keys are Worker secrets. Logs carry ids, statuses, and codes only. Cloudflare terminates TLS and the relay reads every frame, so bearer tokens and bodies are visible to it; nothing is end-to-end encrypted.

## Operator setup

No Cloudflare API token, DNS zone, or tunnel is involved.

1. Configure the Clerk instance as the shared contract's README describes (`packages/connect/README.md`, section Clerk). In short:
   - Turn on **Native applications** so the iOS app can sign in through the Native API.
   - Under **Sessions → Customize session token**, add `{ "aud": "https://nyte-connect.daniel-fu90.workers.dev" }`, equal to `CONNECT_ORIGIN`.
   - Add the desktop account window's origins to **Allowed origins** and its redirect URLs to the redirect allowlist: `nyte-desktop://account`, `nyte-desktop-test://account`, and `http://127.0.0.1:5174`. `CLERK_AUTHORIZED_PARTIES` in `wrangler.jsonc` lists the same origins.
2. Add a Clerk webhook endpoint at `<CONNECT_ORIGIN>/v1/clerk/webhook`, subscribed to `user.updated` and `user.deleted`.
3. `wrangler.jsonc` already names the account, the D1 database, the relay Durable Object (a SQLite class, as the Workers Free plan requires), and the vars. Check them before deploying.
4. `wrangler d1 migrations apply nyte-connect --remote`.
5. Set each secret with `wrangler secret put <NAME>`:

   | Secret | Value |
   | --- | --- |
   | `CLERK_JWT_KEY` | The instance's PEM public key. |
   | `CLERK_SECRET_KEY` | The instance's Secret Key. |
   | `CLERK_WEBHOOK_SIGNING_SECRET` | The webhook endpoint's `whsec_…` secret. |
   | `BROKER_SIGNING_KEYS` | A JSON array of Ed25519 private JWKs, each with a `kid`. The first signs; all are published. |

6. `wrangler deploy`.

Generate a broker signing key with:

```sh
node -e 'const { generateKeyPairSync, randomUUID } = require("node:crypto"); const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }); console.log(JSON.stringify([{ ...jwk, kid: randomUUID() }]))'
```

To rotate, put the new key first and keep the old one second until no token signed by it can still be valid, which is one minute.

`.dev.vars.example` lists the secrets for `wrangler dev`. Copy it to `.dev.vars`, which git ignores.

## Tests

`pnpm --dir packages/connect-worker test` runs two kinds of test. Most run the broker in Node against a local D1 from wrangler's `getPlatformProxy` (`test/wrangler.jsonc`), with an injected clock and a fake relay that answers enrollments as a desktop would. `test/relay.test.ts` runs the whole Worker, the relay Durable Object, and D1 in local workerd through wrangler's `createTestHarness` (`test/workerd.ts`, `test/workerd.jsonc`), with real WebSockets and HTTP. Signatures are real everywhere; only Clerk's Backend API is fake. No test reads `.dev.vars`.

Local workerd delivers a phone's disconnect to the Worker about 10 seconds late, and leaves a client socket that never sent a frame in CLOSING when the relay closes it. Neither is relied on in production.
