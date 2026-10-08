# @nyte-ai/connect

The contract for Nyte Connect, Nyte's account-based remote access. A host is a running Nyte that serves sessions: the desktop app, or `nyte serve` on a machine without a screen. Its operator links it to a Nyte account and turns sharing on. Any phone or browser signed in to the same account then lists the host, enrolls itself, and connects, with no approval step on the host. Users need no Tailscale, no shared network, no open port, and no Cloudflare account of their own. The operator (Nyte) runs one broker Worker, with a relay Durable Object per linked host, and one Clerk instance for everyone. The broker is served at `https://nyte-connect.daniel-fu90.workers.dev`; no DNS zone or custom domain is involved.

This package holds the wire contract. The broker lives in `packages/connect-worker`; its README and `wrangler.jsonc` are authoritative for binding names and broker internals. Nothing in this repository creates, deploys, or configures a live resource. Every step below is manual. The user steps are in the [remote access guide](../docs/content/docs/remote-access.mdx).

| Entry | For | Contents |
| --- | --- | --- |
| `@nyte-ai/connect` | broker, host, phone | TypeBox schemas, routes, lifetimes, `relayAddress`, the phone's broker client. Node-free; validated with `Value`, never `Compile`. |
| `@nyte-ai/connect/signing` | broker, host | Ed25519 compact JWS through `jose`. The phone never imports it. |
| `@nyte-ai/connect/relay` | broker, host | Relay frames, limits, close codes, the public path allowlist, and refusal envelopes. Node-free. The phone never imports it. |
| `@nyte-ai/connect/enrollment` | web app, phone | A device secret and its digest, waiting for the host's lease to accept it, and the device's own release with its bearer. |
| `@nyte-ai/connect/account-config` | web app, phone | Parses the public Clerk key and Connect origin; a build without both offers address-and-token connections only. |
| `@nyte-ai/connect/host` | desktop, `nyte serve` | The Node side of a host: link, lease, and enrollment lifecycle, its private store, the broker client, the relay socket, and the enrollment routes. No Electron; the embedding supplies the account session and the listener. |

## How it fits together

1. **Link.** The host generates an Ed25519 machine key and keeps it in its Connect store, a mode 0600 file. It links in one of two ways. The desktop gets a Clerk session JWT from its sign-in window, sealed with Electron `safeStorage`, and sends it with a proof signed by the machine key. `nyte account login` holds no Clerk session. It opens a link transaction signed by the key, with a short code the broker stores only as a hash. The owner opens the broker's `/link` page on the hosted web app, signs in, enters the code, compares the key fingerprint, and approves. The host polls and completes the link with another signed proof. Either way the broker creates the environment and returns its id, and every later call is signed with the machine key.
2. **Relay.** While serving, the host opens a WebSocket to `/v1/environments/<id>/relay`. Its first frame is a proof for that exact request; the relay verifies it, spends its `jti`, and only then forwards anything. One socket serves an environment at a time: a newer one replaces the older, which stops instead of fighting back. The framing, limits, and close codes are in `src/relay.ts`.
3. **Lease.** While serving, the host also asks for a broker-signed lease every 20 seconds. A lease lives 60 seconds and lists the device ids allowed in. Without a current lease, every account device is refused and its streams are closed. A lease is bound to the request that asked for it and ordered by a policy counter, so neither a replay nor a late answer can restore a revoked device.
4. **Enroll.** The phone generates a 256-bit token with the native CSPRNG (`getRandomBytesAsync`) and sends only its SHA-256 digest to the broker under its Clerk session. The broker checks that the session's owner owns the environment, reserves the device, sends a signed enrollment to the host over the relay itself, and checks the host's signed receipt before it activates the device. The host signs that receipt itself while sharing is on; nobody approves the device there. No public route reaches the host's enrollment.
5. **Use.** The phone calls `relayAddress(origin, environmentId)`, which is `<origin>/r/<id>`, through the existing Nyte HTTP and SSE client with that bearer token. The broker forwards a request only when the token's digest belongs to an active device of that environment, and only to the Nyte server's `/v1` routes or to the phone's own release at `/_nyte/connect/device`. The host checks the digest and its current lease again.

### Codes, QR codes, and host identity

- **Host linking code.** The eight characters `nyte account login` prints. The account owner enters it on the `/link` page to approve linking that host. It expires after five minutes and gives no device access.
- **Connection QR code.** The desktop's manual setup shows `nyte://connect?url=…&token=…`. The token is a bearer for that direct listener, and anyone holding it connects without an account. Connect is not involved.
- **Signed host identity.** `nyte serve` names a `hostId` and an Ed25519 public key in `/v1/info` and signs a client's nonce at `/v1/identity`. Clients pin it per route and refuse a different key at the same address until the user pairs again. It is not the Connect machine key. Desktop shares name no identity.

### What it protects, and what it does not

- The broker holds the Clerk keys. Hosts and phones hold none of its secrets.
- **The relay sees everything.** Cloudflare terminates TLS, and the broker Worker reads every relayed request and response: device bearer tokens, prompts, file contents, and answers, all in plain text. There is no end-to-end encryption. Anyone who controls the broker, its Cloudflare account, or Cloudflare can read and replay that traffic and impersonate an enrolled phone until its token is revoked.
- The broker hashes a phone's bearer token to decide whether to forward a request. It must never store or log the token or any relayed body. Enrollment itself sends only a digest. A compromised broker can still enroll its own digest on any linked host. The desktop lists account devices and can revoke them. `nyte account status` lists a headless host's devices, and `nyte account unlink` refuses them all.
- Device tokens are bearer tokens: a copied token works until it is revoked. This is not DPoP, and sessions are not bound to a device key.
- Browser device tokens belong only in `sessionStorage`, never localStorage, cookies, URLs, or logs. They end client-side when the tab closes. A tab-close counts as releasing and forgetting the credential client-side. Release explicitly with the device bearer when switching hosts, and revoke on sign-out. Closing a tab sends nothing, because the same unload fires on reload: it does not revoke the device or invalidate a stolen copy, which works until the owner revokes it. Browser session restoration can also restore sessionStorage; do not promise server-enforced tab lifetimes.
- Any XSS on `app.nyte.sh` can steal browser tokens and use them outside the browser. `app.nyte.sh` must ship a strict CSP, without unsafe inline scripts or eval, with narrowly scoped script and connection sources for Clerk and the broker. CORS is not token protection and does not stop a non-browser caller. The broker reads browser relayed traffic just as it reads phone traffic.
- Revocation takes effect within one lease lifetime (60 seconds) even when the relay misbehaves, because the host refuses any device its unexpired lease does not list. Closing the relay socket also ends every open stream at once.
- Ending a device comes in two strengths. **Revoke** (an owner removing a device from the desktop or the phone, or a phone signing out) also tombstones and revokes the Clerk session that enrolled it, so that session cannot enroll again silently. **Release** (a phone dropping its own credential after a cancelled connect, a failed check, or a switch to another host) ends only that device. Only the host can call the broker's release route, with its machine key, and only for the device whose own token asked it to; it never clears a tombstone.

## Clerk

Use a Clerk instance dedicated to Nyte. The broker treats that instance as the only issuer.

1. **Native API.** Turn it on under **Native applications**.
2. **Session token audience.** Under **Sessions → Customize session token**, add this claim and save:

   ```json
   { "aud": "https://nyte-connect.daniel-fu90.workers.dev" }
   ```

   The value must equal `CONNECT_ORIGIN` exactly. Desktop and phone both send standard session tokens; JWT templates are not used, because they carry no `sid`.
3. **Allowed origins.** Add the desktop renderer's packaged origin, `nyte-desktop://account` (`nyte-desktop-test://account` for update-test builds), and the renderer's dev origin. Add `https://app.nyte.sh` to the Clerk dashboard's **Allowed origins**, plus `http://localhost:5179` and `http://127.0.0.1:5179` for web development. Allow the web sign-in redirect URLs too. Under **Native applications → Allowlist for mobile SSO redirect**, add `https://nyte.sh/desktop/signed-in`: the desktop sends the browser there after OAuth, and that page opens the `nyte-desktop://account/` deep link. List all of these origins in the Worker's `CLERK_AUTHORIZED_PARTIES`: desktop and browser session tokens carry their page origin as `azp`, and the broker refuses a present `azp` it does not list.
4. **Webhook.** Add an endpoint at `<CONNECT_ORIGIN>/v1/clerk/webhook` subscribed to `user.updated` and `user.deleted`. Store its signing secret as the Worker secret `CLERK_WEBHOOK_SIGNING_SECRET`. A deleted user loses every environment; a banned or locked user's environments stop receiving leases.
5. **Keys for the Worker.** Copy the instance's PEM public key (**API keys → Show JWT public key**) into `CLERK_JWT_KEY`, its Frontend API URL into `CLERK_ISSUER`, and its Secret Key into `CLERK_SECRET_KEY`. The broker uses the Secret Key for the Backend API only: to revoke the Clerk session of a revoked device, to look up the owner's label when a host links, and to recheck the owner's standing.

The webhook is the fast path for a banned, locked, or deleted user; the recheck bounds it when a webhook is lost. A lease asks Clerk again once the last answered lookup is 15 minutes old. If Clerk does not answer, the stored standing keeps serving until that lookup is 60 minutes old; after that, that owner's leases answer 503 and their hosts refuse every device once the last lease lapses, until Clerk answers. A Clerk outage longer than an hour therefore stops remote access for every owner it outlasts. A user Clerk reports as unknown is disabled, not deleted; only the webhook deletes. Session tokens need no `email` claim.

Every Clerk-authenticated broker route accepts a token only if:

- its signature verifies against `CLERK_JWT_KEY`, and it has not expired;
- `iss` equals `CLERK_ISSUER` exactly;
- `aud` equals `CONNECT_ORIGIN`, or is an array containing it. A missing `aud` is refused, because `@clerk/backend` skips the check when the claim is absent;
- `sid` is present and `sts` is not `pending`;
- it carries no `act` claim, so a dashboard impersonation cannot link a host or enroll a device;
- `azp`, when present, is in `CLERK_AUTHORIZED_PARTIES`. Native clients may omit `azp`, so a missing one is accepted. That is why the broker does not pass `authorizedParties` to `verifyToken`, which would refuse it.

## Browser client contract

`createBrokerClient` and `relayAddress` from `@nyte-ai/connect` use browser APIs and no Node APIs. The broker client sends `credentials: "omit"`; it gets a fresh standard Clerk session token through `sessionToken` on each call. Use the hosted broker's canonical HTTPS origin, not the page origin.

```ts
import { base64Url, createBrokerClient, DEVICE_TOKEN_BYTES, relayAddress } from "@nyte-ai/connect";

const broker = createBrokerClient({ origin: connectOrigin, sessionToken: () => clerk.session?.getToken() ?? Promise.resolve(null) });
const { environments } = await broker.listEnvironments({});
const token = base64Url(crypto.getRandomValues(new Uint8Array(DEVICE_TOKEN_BYTES)));
const digest = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
const clientId = base64Url(crypto.getRandomValues(new Uint8Array(16)));
const enrolled = await broker.enroll({ environmentId, request: { clientId, clientName: "Browser", digest } });
const baseUrl = relayAddress(connectOrigin, enrolled.environmentId);
```

Keep the token, client id, and enrolled ids only in the tab's sessionStorage, so each tab has a separate client id. `ClientId` allows 16–64 base64url characters; `Name` allows 1–64 characters. Phones and browsers are clients only. They have no workspace and cannot edit files locally, become environments, act as relay targets, or pair with each other. A browser connects only to a linked host environment through that host's relay. Enrollment has no platform or device-kind field: `EnrollRequest`, `EnrollResponse`, `EnrollmentClaims`, and device records already support browsers unchanged. `DEVICE_TOKEN_BYTES` is 32. The token must contain 256 bits of CSPRNG output encoded as unpadded base64url, 43 characters matching `DeviceToken`. `digest` is SHA-256 of the UTF-8 **token string**, not the original random bytes, encoded as 43-character unpadded base64url matching `Base64Url32`. `base64Url` supplies the encoding without Node dependencies. `role` is optional and absent means `controller`. The host decides whether to honor `owner`; `nyte serve` honors it only with `--device-admin`.

Use `baseUrl` and `Authorization: Bearer <token>` with the existing Nyte HTTP and fetch-based SSE client. Do not use native `EventSource`, which cannot send that authorization header. Send no cookies and set `credentials: "omit"` on relay fetches. The client reads `content-type`, a CORS-safelisted response header. Refusals still use the existing Nyte error envelope. Allow up to `ENROLLMENT_READINESS_SECONDS` for the host's lease to catch up without re-enrolling.

For a weak release, send `DELETE` to `${baseUrl}${DESKTOP_ROUTES.device}` with the device bearer and forget the token client-side. For a strong revoke on sign-out, call `broker.revokeDevice({ environmentId, deviceId })`; that also revokes the enrolling Clerk session. `broker.removeEnvironment({ environmentId })` removes the host from the account. Results use `EnvironmentList`, `EnvironmentSummary`, and `EnrollResponse`; broker failures are `BrokerError.failure`, typed as `BrokerFailure`. `BrokerClient` and `BrokerClientOptions` are the exported client types.

The Worker allows exactly `https://app.nyte.sh`, `http://localhost:5179`, and `http://127.0.0.1:5179` in both its browser allowlist and Clerk authorized parties. The two dev origins are deliberately in production config so local web development can use the hosted relay, like desktop development already does. This trusts pages served at those exact local origins, including other software that binds those ports. They still need valid Clerk JWTs or enrolled bearer tokens. Operators who do not need hosted-relay development can remove both origins from both vars; for a separate development broker, put them in that broker's `.dev.vars`. A local HTTP broker URL is not accepted by the shared client.

CORS is limited to listing environments, owner environment removal, enrollment, owner device revocation, public `/r/:id/v1/...` GET/POST including SSE, and public bearer self-release. No wildcard origin or cookie credentials are allowed. Host linking, leases, sockets, broker machine-key releases, webhook, and key publication have no CORS. Signed machine-key requests on shared deletion routes have no CORS either. Native requests without Origin keep their existing behavior. The relay strips Origin and every browser header except `authorization`, `content-type`, and `accept`; it does not relax the host's origin, host, lease, or token checks on local listeners.

## Cloudflare

- **Worker.** One Worker on its `workers.dev` subdomain. `CONNECT_ORIGIN` is that origin exactly, `https://nyte-connect.daniel-fu90.workers.dev`. It runs on the Workers Free plan; nothing here needs a paid plan.
- **Relay.** A SQLite-backed Durable Object class, one object per environment, holding that host's socket with the WebSocket Hibernation API. The Free plan allows only SQLite-backed classes. Idle sockets cost no duration; pings are answered by `setWebSocketAutoResponse` without waking the object.
- **D1.** One database bound as `DB`, with the migrations in `packages/connect-worker/migrations`.
- **Cron.** The Worker's schedule closes the relays of revoked environments, expires stale reservations, retries pending Clerk session revocations, and purges spent proof ids.

No zone, DNS record, tunnel, or Cloudflare API token is involved.

## Configuration

### Public, in builds

| Where | Name | Value |
| --- | --- | --- |
| Desktop main | `MAIN_VITE_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST` | `clerk.example.com` (no scheme) |
| Web app, `packages/app` | `VITE_NYTE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Web app, `packages/app` | `VITE_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| CLI, `packages/tui` | `NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| iOS | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| iOS | `EXPO_PUBLIC_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |

All of these are public by design. A build missing any of them shows account remote access as unavailable; there is no built-in fallback. The connect origin must be a canonical `https://` origin; the broker client refuses anything else before it asks Clerk for a token.

The CLI reads `NYTE_CONNECT_ORIGIN` at build time, and a value in the running process's environment overrides it. Without either, `nyte account` and `nyte serve --account` refuse. The release workflow fails the CLI build when the repository variable is unset.

The iOS app needs a new native build for Clerk: `@clerk/expo` raises the deployment target to iOS 17 and brings `expo-auth-session` and `expo-web-browser`.

### Worker

`packages/connect-worker/wrangler.jsonc` is authoritative. It needs:

| Kind | Name | Notes |
| --- | --- | --- |
| var | `CONNECT_ORIGIN` | The Worker's `workers.dev` origin and the Clerk `aud` claim. |
| var | `CONNECT_WEB_ORIGINS` | Comma-separated exact canonical browser origins. HTTPS, or HTTP loopback for development. Empty disables browser access. |
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

`BROKER_SIGNING_KEYS` is a JSON array; the first key signs and every key is published. Hosts pin the published key set (`/.well-known/jwks.json`) at link time and refetch it only when a token names an unknown `kid`. To rotate, publish the new key beside the old one, switch signing to it, and remove the old key once no unexpired token uses it, which takes at most a minute.

## Deploying by hand

1. Create the Clerk instance and configure it as in [Clerk](#clerk).
2. `wrangler d1 create nyte-connect`, then put the printed id in `wrangler.jsonc`.
3. `wrangler d1 migrations apply nyte-connect --remote`.
4. Replace every placeholder var in `wrangler.jsonc`.
5. Set each secret with `wrangler secret put`.
6. `wrangler deploy` from `packages/connect-worker`.
7. Point the Clerk webhook at the deployed `/v1/clerk/webhook` and send a test event.
8. Build the desktop, the CLI, the web app, and the iOS app with the public values above.
9. Link a host, enroll a phone, revoke the phone from the desktop, and confirm its streams close within a minute.

A broker runs at the origin above. This repository doesn't record which commit it runs, so check that a deployment includes a route before relying on it.

## Lifetimes

| Value | Seconds | Meaning |
| --- | --- | --- |
| `PROOF_LIFETIME_SECONDS` | 60 | Window for a host request proof; its `jti` is spent once. |
| `LEASE_LIFETIME_SECONDS` | 60 | Longest any device stays authorized without a fresh lease. |
| `HEARTBEAT_INTERVAL_SECONDS` | 20 | How often a serving host asks for a lease. |
| `ENROLLMENT_LIFETIME_SECONDS` | 60 | Window for a broker enrollment; the host spends its `jti` durably. |
| `ENROLLMENT_READINESS_SECONDS` | 10 | How long a phone may retry a fresh token while the lease catches up. A refusal after that means revoked. |
| `ONLINE_WINDOW_SECONDS` | 90 | A host without a heartbeat for this long lists as offline, even with its relay socket open. |
| `LINK_TRANSACTION_LIFETIME_SECONDS` | 300 | How long a host linking code waits for approval. |

The relay's own limits live in `src/relay.ts`: 5 seconds to authenticate a socket, 32 channels per socket, 32 KiB per frame chunk, a 256 KiB credit window per channel and direction, 8 MiB per request body, and a ping every 20 seconds.
