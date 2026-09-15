# @nyte-ai/ai

Provider streaming, authentication, and the model catalog. Every Nyte client composes the same
providers through `createNyteModels()` over the shared `~/.nyte` credential and model stores
(`NYTE_HOME` overrides the directory), so a login made in one client is a login in all of them.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/models.ts` | `Provider`, `Models`, `createProvider`, auth resolution, catalog refresh and publication |
| `src/auth/` | Credential types and stores, api-key helpers, OAuth flows under `auth/oauth/` |
| `src/api/` | Wire adapters: Anthropic Messages, OpenAI Responses and Chat Completions, Codex, Google |
| `src/api/github-copilot-headers.ts` | Copilot identity shared by auth, catalog generation, and request adapters |
| `src/providers/` | Provider factories and the baked catalog data they ship |
| `src/providers/nyte-catalog.ts` | The provider list and default models each client starts from |
| `scripts/` | Catalog generation and checks (`pnpm models:generate`, `pnpm models:check`) |

Most flows are ports from pi; each file names its upstream source and the revision it was synced with.

## Providers

| Provider | Auth | Catalog |
| --- | --- | --- |
| `openai-codex` | ChatGPT OAuth (browser or device code) | Baked |
| `openai`, `anthropic` | API key from the environment or a stored key; Anthropic also offers OAuth | Baked |
| `opencode`, `opencode-go` | `OPENCODE_API_KEY` or a stored key | Baked snapshot, refreshed from models.opencode.ai |
| `github-copilot` | GitHub device sign-in or an injected bearer token | Generated definitions, filtered by OAuth account model IDs |

## Credential storage

`FileCredentialStore` keeps one credential per provider in `~/.nyte/auth.json`. A TUI, a desktop
window, and a host can all write that file, so every mutation takes `auth.json.lock` and holds it
across the whole read-modify-write, including the OAuth refresh that `Models` runs inside `modify`.
A rotating refresh token is therefore spent once, not once per client. The lock names its owning
process, host, and acquisition, so a crashed client's lock is taken over at once when it came from
this machine. Any lock older than a minute is reclaimed even if a process still claims it, because
pids get reused and a suspended machine wakes with held locks; a refresh interrupted that way costs
the user a sign-in, so refreshes are capped well below that. A holder whose lock was reclaimed
reports that nothing was written instead of publishing over the client that holds it now.

Writes publish by renaming a temporary file over `auth.json`, so readers take no lock and never
observe a half-written file. A file that cannot be read fails the operation instead of resolving
empty, including for providers that would otherwise fall back to an environment variable: an
unparseable `auth.json` is a typo to fix, not a reason to overwrite every stored login. Entries
that this version cannot parse are reported as no credential and left on disk untouched, so a
downgrade cannot drop credentials a newer build wrote.

## GitHub Copilot

The OAuth flow follows [Pi at `71dca871`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/ai/src/auth/oauth/github-copilot.ts):

```text
Host starts GitHub device authorization
  -> UI displays verification URL and code
  -> host polls GitHub for its access token
  -> host exchanges that token at /copilot_internal/v2/token
  -> host fetches /models with the Copilot session token
  -> credential store saves both tokens and account model IDs
```

`refresh` stores the GitHub token. `access` stores the short-lived Copilot session token.
`expires` is the session token's actual expiry; shared auth resolution already refreshes five
minutes early under the credential store lock. Refresh repeats the exchange and account model
lookup without another device login. A failed lookup does not persist a partial login or refresh.
Credential reads validate both tokens, expiry, and account model IDs through one schema. Incomplete
or old direct-token credentials require a fresh sign-in.

Client identity follows Pi's public Copilot OAuth client, `Iv1.b507a08c87ecfe98`, and its Copilot
editor headers. This is not Nyte's OAuth app, and the device-code instructions say so. The
`clientId` option or `NYTE_GITHUB_COPILOT_CLIENT_ID` can select a host's own client, but that client
must be permitted to use Copilot's token exchange. A successful GitHub device grant alone does
not establish that permission. This integration does not establish official Copilot client support.

The session token's `proxy-ep` chooses the API origin. Only HTTPS origins under
`*.githubcopilot.com` on the default port are accepted; an untrusted endpoint fails before the
session token leaves the host. A token without `proxy-ep` uses
`https://api.individual.githubcopilot.com`. Requests refuse redirects, time out after 15 seconds
including body reading, and expose fixed errors with HTTP status or known OAuth error codes,
never remote response bodies or token-bearing transport messages. Device polling is cancellable
and bounded by the code's lifetime. Verification URLs must name a GitHub HTTPS login page.

### Model definitions and account access

`pnpm --dir packages/ai models:generate` generates the Copilot definitions alongside the other
baked catalogs. Endpoint routes, limits, reasoning controls, and prices come from those definitions.
The authenticated `/models` response supplies availability, not a second complete model schema.
Missing `supported_endpoints`, limits, or billing metadata therefore does not drop a known model.
Unknown IDs wait for a catalog update rather than receiving guessed routes.

`getModels()` returns the generated definitions. `getAvailable()` applies the account's
`availableModelIds`. Those IDs live with the credential, so another client can restore them offline
without a separate Copilot model-cache entry. Login and token refresh replace the list, including
an empty list. Disabled policies and explicit lack of tool support are excluded. When every picker
flag is false, only the Individual endpoint falls back to explicitly enabled policies, as Pi does.
Unlike Pi, Nyte does not automatically enable unconfigured model policies. It reports that account
approval is needed and leaves those models unavailable until enabled.

Generated prices are model-rate estimates, not a calculation of Copilot subscription charges or
premium-request usage. Request adapters retain Copilot headers, vision declarations, opaque
Chat Completions reasoning, and encrypted Responses reasoning across turns.

### Browser and server hosts

Use the narrow package exports instead of the main index, which also exports Node file stores:

```ts
import { InMemoryCredentialStore } from "@nyte-ai/ai/auth/credential-store";
import type { AuthInteraction } from "@nyte-ai/ai/auth/types";
import { createModels } from "@nyte-ai/ai/models";
import { githubCopilotProvider } from "@nyte-ai/ai/providers/github-copilot";

const credentials = new InMemoryCredentialStore();
const models = createModels({ credentials });
models.setProvider(githubCopilotProvider());

async function connect(interaction: AuthInteraction) {
  await models.login("github-copilot", "oauth", interaction);
  return models.getAvailable("github-copilot");
}
```

`@nyte-ai/ai/auth/oauth/github-copilot` also exposes the fetch-only flow directly. Both entrypoints
accept an injected `fetch`. No terminal, browser opener, callback listener, or filesystem is needed.
The browser-bundle test runs login in a realm without Node globals using a simulated HTTP boundary;
it does not prove GitHub CORS support.

For a web application, keep both tokens and credential storage on the server. Send the browser only
device-code instructions, progress, and safe completion metadata. The server polls and refreshes;
the browser's cancel action aborts the host-owned signal. Nyte's remote protocol does not yet expose
provider-login operations, so these exports support embedding hosts, not remote login in the shipped
web client. Use a durable, user-isolated `CredentialStore` in a server instead of the example's
in-memory store. Do not share one user's credentials across tenants.

Like Pi, the API-key method accepts `COPILOT_GITHUB_TOKEN`, a stored bearer token, or an explicit
request token for headless hosts. That method passes the token through and does not exchange or
refresh it, or discover account model IDs. Hosts must supply a token accepted by the Copilot API;
OAuth is the path that manages token exchange, expiry, and account filtering.

Not covered: GitHub Enterprise domains, automatic model-policy opt-in, subagent/title/compaction
interaction types, remote provider-login protocol operations, and live validation of this rewritten
flow with a fresh sign-in and inference request.

## Verification

```sh
pnpm --dir packages/ai test
pnpm --dir packages/ai typecheck
```

`pnpm --dir packages/ai test` runs the catalog data check first, then Vitest. All tests live in
`test/`, including cases ported from Pi. There is no separate upstream suite. Package typecheck
includes every test and fixture recursively.

Transport tests inject HTTP or WebSocket fixtures at the network boundary and exercise the real
adapters. They run without provider credentials or live API calls.

## Account usage windows

The Claude and Codex account-limit fetchers normalize percentages used and reset
timestamps separately from token consumption. Claude supports the named 5-hour
and weekly buckets plus model-specific `weekly_scoped` entries in the response's
`limits` array, including Fable. Scoped windows use `seven_day_<display_name>` ids.
Missing or malformed windows are omitted; a missing reset stays unknown.
Requests remain cancellable through response-body reading.
