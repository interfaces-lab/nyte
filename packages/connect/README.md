# @nyte-ai/connect

The contract for Nyte Connect, Nyte's account-based remote access. A user signs in to the same Nyte account on the desktop and on the iOS app, turns on remote access on the desktop, and the phone lists that Mac and connects. Users need no Tailscale, no shared network, no open port, and no Cloudflare account of their own. The operator (Nyte) runs one broker Worker, with a relay Durable Object per linked desktop, and one Clerk instance for everyone. The broker is served at `https://nyte-connect.daniel-fu90.workers.dev`; no DNS zone or custom domain is involved.

This package holds the wire contract. The broker lives in `packages/connect-worker`; its README and `wrangler.jsonc` are authoritative for binding names and broker internals. Nothing in this repository creates, deploys, or configures a live resource. Every step below is manual.

| Entry | For | Contents |
| --- | --- | --- |
| `@nyte-ai/connect` | broker, desktop, phone | TypeBox schemas, routes, lifetimes, `relayAddress`, the phone's broker client. Node-free; validated with `Value`, never `Compile`. |
| `@nyte-ai/connect/signing` | broker, desktop | Ed25519 compact JWS through `jose`. The phone never imports it. |
| `@nyte-ai/connect/relay` | broker, desktop | Relay frames, limits, close codes, the public path allowlist, and refusal envelopes. Node-free. The phone never imports it. |

## How it fits together

1. **Link.** The desktop's sign-in dialog gets a Clerk session JWT. The desktop generates an Ed25519 machine key, sealed with Electron `safeStorage`, and sends the JWT with a proof signed by that key. The broker creates the environment and returns its id. After this the desktop never needs a Clerk session again: every later call is signed with the machine key.
2. **Relay.** While serving, the desktop opens a WebSocket to `/v1/environments/<id>/relay`. Its first frame is a proof for that exact request; the relay verifies it, spends its `jti`, and only then forwards anything. One socket serves an environment at a time: a newer one replaces the older, which stops instead of fighting back. The framing, limits, and close codes are in `src/relay.ts`.
3. **Lease.** While serving, the desktop also asks for a broker-signed lease every 20 seconds. A lease lives 60 seconds and lists the device ids allowed in. Without a current lease, every account device is refused and its streams are closed. A lease is bound to the request that asked for it and ordered by a policy counter, so neither a replay nor a late answer can restore a revoked device.
4. **Enroll.** The phone generates a 256-bit token with the native CSPRNG (`getRandomBytesAsync`) and sends only its SHA-256 digest to the broker under its Clerk session. The broker reserves the device, sends a signed enrollment to the desktop over the relay itself, and checks the desktop's signed receipt before it activates the device. No public route reaches the desktop's enrollment.
5. **Use.** The phone calls `relayAddress(origin, environmentId)`, which is `<origin>/r/<id>`, through the existing Nyte HTTP and SSE client with that bearer token. The broker forwards a request only when the token's digest belongs to an active device of that environment, and only to the Nyte server's `/v1` routes or to the phone's own release at `/_nyte/connect/device`. The desktop checks the digest and its current lease again.

### What it protects, and what it does not

- The broker holds the Clerk keys. Desktops and phones hold none of its secrets.
- **The relay sees everything.** Cloudflare terminates TLS, and the broker Worker reads every relayed request and response: device bearer tokens, prompts, file contents, and answers, all in plain text. There is no end-to-end encryption. Anyone who controls the broker, its Cloudflare account, or Cloudflare can read and replay that traffic and impersonate an enrolled phone until its token is revoked.
- The broker hashes a phone's bearer token to decide whether to forward a request. It must never store or log the token or any relayed body. Enrollment itself sends only a digest. A compromised broker can still enroll its own digest on any linked desktop. The desktop lists account devices and can revoke them.
- Device tokens are bearer tokens: a copied token works until it is revoked. This is not DPoP, and sessions are not bound to a device key.
- Revocation takes effect within one lease lifetime (60 seconds) even when the relay misbehaves, because the desktop refuses any device its unexpired lease does not list. Closing the relay socket also ends every open stream at once.
- Ending a device comes in two strengths. **Revoke** (an owner removing a device from the desktop or the phone, or a phone signing out) also tombstones and revokes the Clerk session that enrolled it, so that session cannot enroll again silently. **Release** (a phone dropping its own credential after a cancelled connect, a failed check, or a switch to another Mac) ends only that device. Only the desktop can ask for a release, with its machine key, and only for the device whose own token asked it to; it never clears a tombstone.

## Clerk

Use a Clerk instance dedicated to Nyte. The broker treats that instance as the only issuer.

1. **Native API.** Turn it on under **Native applications**.
2. **Session token audience.** Under **Sessions → Customize session token**, add this claim and save:

   ```json
   { "aud": "https://nyte-connect.daniel-fu90.workers.dev" }
   ```

   The value must equal `CONNECT_ORIGIN` exactly. Desktop and phone both send standard session tokens; JWT templates are not used, because they carry no `sid`.
3. **Allowed origins.** Add the desktop renderer's packaged origin, `nyte-desktop://account` (`nyte-desktop-test://account` for update-test builds), and the renderer's dev origin. List the same origins in the Worker's `CLERK_AUTHORIZED_PARTIES`: desktop session tokens carry the renderer's origin as `azp`, and the broker refuses a present `azp` it does not list.
4. **Webhook.** Add an endpoint at `<CONNECT_ORIGIN>/v1/clerk/webhook` subscribed to `user.updated` and `user.deleted`. Store its signing secret as the Worker secret `CLERK_WEBHOOK_SIGNING_SECRET`. A deleted user loses every environment; a banned or locked user's environments stop receiving leases.
5. **Keys for the Worker.** Copy the instance's PEM public key (**API keys → Show JWT public key**) into `CLERK_JWT_KEY`, its Frontend API URL into `CLERK_ISSUER`, and its Secret Key into `CLERK_SECRET_KEY`. The broker uses the Secret Key for the Backend API only: to revoke the Clerk session of a revoked device, to look up the owner's label when a desktop links, and to recheck the owner's standing.

The webhook is the fast path for a banned, locked, or deleted user; the recheck bounds it when a webhook is lost. A lease asks Clerk again once the last answered lookup is 15 minutes old. If Clerk does not answer, the stored standing keeps serving until that lookup is 60 minutes old; after that, that owner's leases answer 503 and their desktops refuse every device once the last lease lapses, until Clerk answers. A Clerk outage longer than an hour therefore stops remote access for every owner it outlasts. A user Clerk reports as unknown is disabled, not deleted; only the webhook deletes. Session tokens need no `email` claim.

Every Clerk-authenticated broker route accepts a token only if:

- its signature verifies against `CLERK_JWT_KEY`, and it has not expired;
- `iss` equals `CLERK_ISSUER` exactly;
- `aud` equals `CONNECT_ORIGIN`, or is an array containing it. A missing `aud` is refused, because `@clerk/backend` skips the check when the claim is absent;
- `sid` is present and `sts` is not `pending`;
- it carries no `act` claim, so a dashboard impersonation cannot link a desktop or enroll a device;
- `azp`, when present, is in `CLERK_AUTHORIZED_PARTIES`. Native clients may omit `azp`, so a missing one is accepted. That is why the broker does not pass `authorizedParties` to `verifyToken`, which would refuse it.

## Cloudflare

- **Worker.** One Worker on its `workers.dev` subdomain. `CONNECT_ORIGIN` is that origin exactly, `https://nyte-connect.daniel-fu90.workers.dev`. It runs on the Workers Free plan; nothing here needs a paid plan.
- **Relay.** A SQLite-backed Durable Object class, one object per environment, holding that desktop's socket with the WebSocket Hibernation API. The Free plan allows only SQLite-backed classes. Idle sockets cost no duration; pings are answered by `setWebSocketAutoResponse` without waking the object.
- **D1.** One database bound as `DB`, with the migrations in `packages/connect-worker/migrations`.
- **Cron.** The Worker's schedule closes the relays of revoked environments, expires stale reservations, retries pending Clerk session revocations, and purges spent proof ids.

No zone, DNS record, tunnel, or Cloudflare API token is involved.

## Configuration

### Public, in client builds

| Where | Name | Value |
| --- | --- | --- |
| Desktop main | `MAIN_VITE_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST` | `clerk.example.com` (no scheme) |
| iOS | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| iOS | `EXPO_PUBLIC_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |

All of these are public by design. A build missing any of them shows account remote access as unavailable; there is no built-in fallback. The connect origin must be a canonical `https://` origin; the broker client refuses anything else before it asks Clerk for a token.

The iOS app needs a new native build for Clerk: `@clerk/expo` raises the deployment target to iOS 17 and brings `expo-auth-session` and `expo-web-browser`.

### Worker

`packages/connect-worker/wrangler.jsonc` is authoritative. It needs:

| Kind | Name | Notes |
| --- | --- | --- |
| var | `CONNECT_ORIGIN` | The Worker's `workers.dev` origin and the Clerk `aud` claim. |
| var | `CLERK_ISSUER` | The Frontend API URL, compared exactly to `iss`. |
| var | `CLERK_AUTHORIZED_PARTIES` | Comma-separated `azp` values accepted when present: at least `nyte-desktop://account`. Without it, desktop links are refused. |
| secret | `CLERK_JWT_KEY` | PEM public key, for networkless verification. |
| secret | `CLERK_SECRET_KEY` | The instance's Secret Key, for the Backend API calls above. |
| secret | `CLERK_WEBHOOK_SIGNING_SECRET` | `whsec_…` from the webhook endpoint. |
| secret | `BROKER_SIGNING_KEYS` | Ed25519 private JWKs, each with a `kid`; format in the Worker README. |
| binding | `DB` | D1. |
| binding | the relay | The SQLite-backed Durable Object namespace. |

Set secrets with `wrangler secret put <NAME>`. Never commit a value, and never put one in a `vars` block.

A broker signing key can be generated locally:

```sh
node -e 'const { generateKeyPairSync, randomUUID } = require("node:crypto"); const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }); console.log(JSON.stringify([{ ...jwk, kid: randomUUID() }]))'
```

`BROKER_SIGNING_KEYS` is a JSON array; the first key signs and every key is published. Desktops pin the published key set (`/.well-known/jwks.json`) at link time and refetch it only when a token names an unknown `kid`. To rotate, publish the new key beside the old one, switch signing to it, and remove the old key once no unexpired token uses it, which takes at most a minute.

## Deploying by hand

1. Create the Clerk instance and configure it as in [Clerk](#clerk).
2. `wrangler d1 create nyte-connect`, then put the printed id in `wrangler.jsonc`.
3. `wrangler d1 migrations apply nyte-connect --remote`.
4. Replace every placeholder var in `wrangler.jsonc`.
5. Set each secret with `wrangler secret put`.
6. `wrangler deploy` from `packages/connect-worker`.
7. Point the Clerk webhook at the deployed `/v1/clerk/webhook` and send a test event.
8. Build the desktop and the iOS app with the public values above.
9. Link a desktop, enroll a phone, revoke the phone from the desktop, and confirm its streams close within a minute.

None of these steps has been run against live resources from this repository.

## Lifetimes

| Value | Seconds | Meaning |
| --- | --- | --- |
| `PROOF_LIFETIME_SECONDS` | 60 | Window for a desktop request proof; its `jti` is spent once. |
| `LEASE_LIFETIME_SECONDS` | 60 | Longest any device stays authorized without a fresh lease. |
| `HEARTBEAT_INTERVAL_SECONDS` | 20 | How often a serving desktop asks for a lease. |
| `ENROLLMENT_LIFETIME_SECONDS` | 60 | Window for a broker enrollment; the desktop spends its `jti` durably. |
| `ENROLLMENT_READINESS_SECONDS` | 10 | How long a phone may retry a fresh token while the lease catches up. A refusal after that means revoked. |
| `ONLINE_WINDOW_SECONDS` | 90 | A desktop without a heartbeat for this long lists as offline, even with its relay socket open. |

The relay's own limits live in `src/relay.ts`: 5 seconds to authenticate a socket, 32 channels per socket, 32 KiB per frame chunk, a 256 KiB credit window per channel and direction, 8 MiB per request body, and a ping every 20 seconds.
