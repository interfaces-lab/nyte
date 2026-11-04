# @nyte-ai/connect

The wire contract for Nyte Connect, Nyte's account-based remote access. The broker, the host and the phone and browser clients all import it.

A host is a running Nyte that serves sessions: the desktop app, or the `nyte` CLI on a machine without a screen. Its operator links it to a Nyte account and turns sharing on. Any phone or browser signed in to the same account then lists the host, enrolls itself and connects, with no approval step on the host. Users need no Tailscale, no shared network, no open port and no Cloudflare account of their own. Nyte runs one broker Worker, with a relay Durable Object per linked host, and one Clerk instance for everyone. The broker is served at `https://nyte-connect.daniel-fu90.workers.dev`, with no DNS zone or custom domain.

The broker lives in [`@nyte-ai/connect-broker`](../connect-broker/README.md). Its README and `wrangler.jsonc` own the binding names and broker internals. The user steps are in the [remote access guide](../docs/content/docs/remote-access.mdx). Nothing in this repository creates, deploys or configures a live resource, so every operator step below is manual.

## Entry points

| Entry | For | Contents |
| --- | --- | --- |
| `@nyte-ai/connect` | broker, host, phone, browser | TypeBox schemas, routes, lifetimes, `relayAddress` and the broker client. Node-free. Validate with `Value`, never `Compile`. |
| `@nyte-ai/connect/signing` | broker, host | Ed25519 compact JWS through `jose`. Phones never import it. |
| `@nyte-ai/connect/relay` | broker, host | Relay frames, limits, close codes, the public path allowlist and refusal envelopes. Node-free. Phones never import it. |
| `@nyte-ai/connect/enrollment` | web app, phone | A device secret and its digest, waiting for the host's lease to accept it, and the device's own release with its bearer. |
| `@nyte-ai/connect/account-config` | web app, phone | Parses the public Clerk key and Connect origin. A build without both offers only address-and-token connections. |
| `@nyte-ai/connect/host` | desktop, `nyte` CLI | The Node side of a host: the link, lease and enrollment lifecycle, its private store, the broker client, the relay socket and the enrollment routes. It has no Electron code. The embedding app supplies the account session and the listener. |
| `@nyte-ai/connect/private-file` | desktop | `writePrivateFile`, which writes a mode 0600 file through an fsynced temporary file. |

## How it works

1. Link. The host generates an Ed25519 machine key and keeps it in its Connect store, a mode 0600 file. It links in one of two ways.
   - The desktop gets a Clerk session JWT from its sign-in window and sends it once, with a proof signed by the machine key. It doesn't keep the JWT.
   - `nyte account` holds no Clerk session. It opens a link transaction signed by the key and prints a short code, which the broker stores only as a hash. The owner opens the `/link` page on the hosted web app, signs in, enters the code, compares the key fingerprint and approves. The host polls and completes the link with another signed proof.

   Either way, the broker creates the environment and returns its id. The host signs every later call with the machine key.
2. Relay. While serving, the host opens a WebSocket to `/v1/environments/<id>/relay`. Its first frame is a proof for that exact request. The relay verifies the proof and spends its `jti` before it forwards anything. One socket serves an environment at a time. A newer socket replaces the older one, which stops instead of reconnecting. `src/relay.ts` defines the framing, limits and close codes.
3. Lease. While serving, the host also asks for a broker-signed lease every 20 seconds. A lease lives 60 seconds and lists the device ids allowed in. Without a current lease, the host refuses every account device and closes its streams. Each lease is bound to the request that asked for it and ordered by a policy counter, so neither a replay nor a late answer can restore a revoked device.
4. Enroll. The phone generates a 256-bit token with the native CSPRNG and sends only its SHA-256 digest to the broker under its Clerk session. The broker checks that the session's owner owns the environment, reserves the device, sends a signed enrollment to the host over the relay and checks the host's signed receipt before it activates the device. The host signs that receipt itself while sharing is on, so nobody approves the device there. No public route reaches the host's enrollment.
5. Use. The phone calls `relayAddress(origin, environmentId)`, which returns `<origin>/r/<id>`, and uses it through the protocol's transport with its bearer token. The broker forwards only these requests:
   - `POST /<operation>` for each row of the protocol's declarations table except the `local` ones
   - `POST /.nyte/streams`, `POST /.nyte/streams/cancel` and `POST /.nyte/ws/ticket`
   - `GET /.nyte/identity` and `GET /.nyte/describe`
   - `GET /.nyte/ws?ticket=<ticket>`, the WebSocket a ticket opens
   - `DELETE /_nyte/connect/device`, the phone's own release

   The `POST` routes need a token whose digest belongs to an active device of that environment. The release accepts a reserved or active device. The discovery routes and the WebSocket need no token, because the host answers discovery unauthenticated and the ticket authenticates the socket. The host checks the digest and its current lease again. `PUBLIC_RELAY_BEARER` in `src/relay.ts` holds these rules.

### Codes, QR codes and host identity

- The host linking code is the eight characters `nyte account` prints. The account owner enters it on the `/link` page to approve linking that host. It expires after five minutes and gives no device access.
- The connection QR code is the `nyte://connect?url=…&token=…` link the desktop's manual setup shows. The token is a bearer for that direct listener, and anyone holding it connects without an account. Connect is not involved.
- Every host listener answers `GET /.nyte/identity?nonce=` with its signed host identity: its `hostId`, an Ed25519 public key and a signature over the nonce, under the key in `~/.nyte/identity.key`. `GET /.nyte/describe` names the host. Clients pin the identity per route and refuse a different key at the same address until the user pairs again. This key is not the Connect machine key.

## Security model

- The broker holds the Clerk keys. Hosts and phones hold none of its secrets.
- The relay sees everything. Cloudflare terminates TLS, and the broker Worker reads every relayed request and response in plain text, including device bearer tokens, prompts, file contents and answers. There is no end-to-end encryption. Anyone who controls the broker, its Cloudflare account or Cloudflare can read and replay that traffic and impersonate an enrolled phone until its token is revoked.
- The broker hashes a phone's bearer token to decide whether to forward a request. It must never store or log the token or any relayed body. Enrollment sends only a digest.
- A compromised broker can still enroll its own digest on any linked host. The desktop lists account devices and can revoke them. `nyte account status` lists a headless host's devices, and `nyte account unlink` refuses them all.
- Device tokens are bearer tokens. A copied token works until it is revoked. Nyte doesn't use DPoP, and sessions aren't bound to a device key.
- Revocation takes effect within one lease lifetime, 60 seconds, even when the relay misbehaves, because the host refuses any device its unexpired lease doesn't list. Closing the relay socket also ends every open stream at once.

Ending a device comes in two strengths:

- Revoke also tombstones and revokes the Clerk session that enrolled the device, so that session can't enroll again silently. An owner removing a device from the desktop or the phone revokes it, and so does a phone signing out.
- Release ends only that device. A phone releases its own credential after a cancelled connect, a failed check or a switch to another host. Only the host can call the broker's release route, with its machine key, and only for the device whose own token asked for it. A release never clears a tombstone.

### Browser clients

- Keep browser device tokens only in `sessionStorage`, never in localStorage, cookies, URLs or logs.
- Closing the tab ends the token client-side and counts as releasing and forgetting it there. Closing a tab sends nothing to the broker, because the same unload fires on reload. It doesn't revoke the device or invalidate a stolen copy, which works until the owner revokes it.
- Release explicitly with the device bearer when you switch hosts, and revoke on sign-out.
- Browser session restore can also restore `sessionStorage`, so don't promise server-enforced tab lifetimes.
- Any XSS on `app.nyte.sh` can steal browser tokens and use them outside the browser. `app.nyte.sh` must ship a strict CSP with no unsafe inline scripts or eval, and with narrowly scoped script and connection sources for Clerk and the broker.
- CORS doesn't protect tokens and doesn't stop a non-browser caller. The broker reads browser traffic the same way it reads phone traffic.

## Clerk

Use a Clerk instance dedicated to Nyte. The broker treats that instance as the only issuer.

1. Turn on the Native API under **Native applications**.
2. Under **Sessions → Customize session token**, add this claim and save:

   ```json
   { "aud": "https://nyte-connect.daniel-fu90.workers.dev" }
   ```

   The value must equal `CONNECT_ORIGIN` exactly. Desktop and phone both send standard session tokens. Don't use JWT templates, because they carry no `sid`.
3. Add these origins to **Allowed origins**, and allow their sign-in redirect URLs:
   - the desktop renderer's packaged origin, `nyte-desktop://account`, and `nyte-desktop-test://account` for update-test builds
   - the desktop renderer's dev origin, `http://127.0.0.1:5174`
   - `https://app.nyte.sh`
   - `http://localhost:5179` and `http://127.0.0.1:5179` for web development
4. Under **Native applications → Allowlist for mobile SSO redirect**, add `https://nyte.sh/desktop/signed-in`. The desktop sends the browser there after OAuth, and that page opens the `nyte-desktop://account/` deep link.
5. List every origin from step 3 in the Worker's `CLERK_AUTHORIZED_PARTIES`. Desktop and browser session tokens carry their page origin as `azp`, and the broker refuses an `azp` it doesn't list.
6. Add a webhook endpoint at `<CONNECT_ORIGIN>/v1/clerk/webhook`, subscribed to `user.updated` and `user.deleted`. Store its signing secret as the Worker secret `CLERK_WEBHOOK_SIGNING_SECRET`. A deleted user loses every environment. A banned or locked user's environments stop receiving leases.
7. Copy the instance's PEM public key from **API keys → Show JWT public key** into `CLERK_JWT_KEY`, its Frontend API URL into `CLERK_ISSUER`, and its Secret Key into `CLERK_SECRET_KEY`. The broker uses the Secret Key only for Backend API calls. It revokes the Clerk session of a revoked device, looks up the owner when a host links, and reconciles owners' standing from the cron.

The webhook is the fast path for a banned, locked or deleted user. Every five minutes the cron asks Clerk about every owner who holds an active environment, which catches a lost webhook. No lease or relayed request waits on Clerk, so a Clerk outage stops nothing already linked. Linking a host answers 503 until Clerk answers. The broker disables a user Clerk reports as unknown but doesn't delete it. Only the webhook deletes. Session tokens need no `email` claim.

Every Clerk-authenticated broker route accepts a token only if all of these hold:

- Its signature verifies against `CLERK_JWT_KEY`, and it hasn't expired.
- `iss` equals `CLERK_ISSUER` exactly.
- `aud` equals `CONNECT_ORIGIN`, or is an array that contains it. The broker refuses a missing `aud`, because `@clerk/backend` skips the check when the claim is absent.
- `sid` is present, and `sts`, when present, is `active`.
- It carries no `act` claim, so a dashboard impersonation can't link a host or enroll a device.
- `azp`, when present, is in `CLERK_AUTHORIZED_PARTIES`. Native clients may omit `azp`, so the broker accepts a missing one. For that reason the broker doesn't pass `authorizedParties` to `verifyToken`, which would refuse it.

## Browser client

`createBrokerClient` and `relayAddress` from `@nyte-ai/connect` use browser APIs and no Node APIs. The broker client sends `credentials: "omit"` and gets a fresh standard Clerk session token through `sessionToken` on each call. Point `origin` at the hosted broker's canonical HTTPS origin, not the page origin.

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

Keep the token, client id and enrolled ids only in the tab's `sessionStorage`, so each tab has its own client id.

| Field | Format |
| --- | --- |
| token | 256 bits of CSPRNG output, `DEVICE_TOKEN_BYTES` (32) bytes, encoded as 43 characters of unpadded base64url matching `DeviceToken`. |
| `digest` | SHA-256 of the UTF-8 token string, not of the original random bytes, encoded as 43 characters of unpadded base64url matching `Base64Url32`. `base64Url` encodes without Node. |
| `clientId` | 16 to 64 base64url characters, matching `ClientId`. |
| `clientName` | 1 to 64 characters, matching `Name`. |
| `role` | Optional. Absent means `controller`. The host decides whether to honor `owner`. |

Enrollment has no platform or device-kind field. `EnrollRequest`, `EnrollResponse`, `EnrollmentClaims` and device records work for browsers as they are.

Phones and browsers are clients only. They have no workspace and can't edit files locally, become environments, act as relay targets or pair with each other. A browser connects only to a linked host environment, through that host's relay.

Use the relay address as the transport's `url` and send `Authorization: Bearer <token>` in its headers. The transport's fetch-based SSE sends that header, which native `EventSource` can't. Send no cookies and set `credentials: "omit"` on relay fetches. The relay passes `Content-Type`, `Cache-Control`, `X-Nyte-Host`, `X-Nyte-Credential`, `X-Nyte-Version`, `X-Nyte-Mime` and `X-Nyte-Channel` back and exposes them to allowed origins. Refusals are the host's wire error, so the transport rethrows them as `SdkError`. Allow up to `ENROLLMENT_READINESS_SECONDS` for the host's lease to catch up before you re-enroll.

To end a device:

- For a weak release, send `DELETE` to `${baseUrl}${DESKTOP_ROUTES.device}` with the device bearer, then forget the token client-side.
- For a strong revoke on sign-out, call `broker.revokeDevice({ environmentId, deviceId })`. It also revokes the enrolling Clerk session.
- To remove the host from the account, call `broker.removeEnvironment({ environmentId })`.

Results use `EnvironmentList`, `EnvironmentSummary` and `EnrollResponse`. Broker failures are `BrokerError`, with `failure` typed as `BrokerFailure`. `BrokerClient` is the exported client type.

The Worker allows exactly `https://app.nyte.sh`, `http://localhost:5179` and `http://127.0.0.1:5179`, both as browser origins and as Clerk authorized parties. The shared client refuses a local HTTP broker URL. The broker README lists the routes that allow CORS and how to remove the dev origins, under [Browser access](../connect-broker/README.md#browser-access).

## Configuration

### Public build values

| Where | Name | Value |
| --- | --- | --- |
| Desktop main | `MAIN_VITE_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Desktop main | `MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST` | `clerk.example.com`, with no scheme |
| Web app, `packages/app` | `VITE_NYTE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| Web app, `packages/app` | `VITE_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| CLI, `packages/tui` | `NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |
| iOS | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| iOS | `EXPO_PUBLIC_NYTE_CONNECT_ORIGIN` | `https://nyte-connect.daniel-fu90.workers.dev` |

All of these values are public. A build missing any of them shows account remote access as unavailable, with no built-in fallback. The connect origin must be a canonical `https://` origin. The broker client refuses anything else before it asks Clerk for a token.

The CLI reads `NYTE_CONNECT_ORIGIN` at build time, and a value in the running process's environment overrides it. Without either, `nyte account` refuses.

The iOS app signs in through `@clerk/expo`, which needs iOS 17 and brings `expo-auth-session` and `expo-web-browser`.

### Worker

The broker README lists the Worker's vars, secrets and bindings, and how to generate and rotate `BROKER_SIGNING_KEYS`. See [Configuration](../connect-broker/README.md#configuration).

## Deploy

1. Create the Clerk instance and configure it as in [Clerk](#clerk).
2. Deploy the broker as its [Operator setup](../connect-broker/README.md#operator-setup) describes.
3. Point the Clerk webhook at the deployed `/v1/clerk/webhook` and send a test event.
4. Build the desktop, the CLI, the web app and the iOS app with the public values above.
5. Link a host, enroll a phone, revoke the phone from the desktop, and confirm its streams close within a minute.

The repository doesn't record which commit the hosted broker runs. Check that a deployment includes a route before you rely on it.

## Lifetimes

| Value | Seconds | Meaning |
| --- | --- | --- |
| `PROOF_LIFETIME_SECONDS` | 60 | Window for a host request proof. Its `jti` is spent once. |
| `LEASE_LIFETIME_SECONDS` | 60 | Longest any device stays authorized without a fresh lease. |
| `HEARTBEAT_INTERVAL_SECONDS` | 20 | How often a serving host asks for a lease. |
| `ENROLLMENT_LIFETIME_SECONDS` | 60 | Window for a broker enrollment. The host spends its `jti` durably. |
| `ENROLLMENT_READINESS_SECONDS` | 10 | How long a phone may retry a fresh token while the lease catches up. A refusal after that means revoked. |
| `ONLINE_WINDOW_SECONDS` | 90 | A host without a heartbeat for this long lists as offline, even with its relay socket open. |
| `LINK_TRANSACTION_LIFETIME_SECONDS` | 300 | How long a host linking code waits for approval. |

`src/relay.ts` sets the relay's limits:

| Limit | Value |
| --- | --- |
| Time to authenticate a socket | 5 seconds |
| Channels per socket | 32 |
| Frame chunk | 32 KiB |
| Credit window per channel and direction | 256 KiB |
| Request body | 8 MiB |
| Ping interval | 20 seconds |

## Development

```sh
pnpm --dir packages/connect test
pnpm --dir packages/connect typecheck
```
