# @nyte-ai/ai

Provider streaming, authentication and model catalogs for Nyte. Every Nyte client composes the
same providers over the same credential and model stores, so a login made in one client is a login
in all of them.

## Quick start

`createNyteModels` registers every provider over the stores in `~/.nyte`:

```ts
import { createNyteModels } from "@nyte-ai/ai";

const models = createNyteModels();
await models.refresh({ providers: ["openai"] });
const available = await models.getAvailable("openai");
```

The main entry also exports the Node file stores. In a browser or a server that keeps credentials
elsewhere, import the narrow entries instead, as the [GitHub Copilot example](#browser-and-server-hosts)
shows.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `NYTE_HOME` | `~/.nyte` | Directory that holds `auth.json` and `models-store.json` |
| `NYTE_MODELS_URL` | `DEFAULT_MODELS_CATALOG_URL` | Origin of the hosted model catalogs |
| `NYTE_GITHUB_COPILOT_CLIENT_ID` | `Iv1.b507a08c87ecfe98` | GitHub OAuth client for Copilot sign-in |

Provider API keys come from the environment variables in the next table or from a stored key.

## Providers

| Provider | Auth | Catalog |
| --- | --- | --- |
| `openai-codex` | ChatGPT OAuth, in the browser or with a device code | Hosted JSON feed |
| `openai` | `OPENAI_API_KEY` or a stored key | Hosted JSON feed |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, a stored key, OAuth, or workload identity federation | Hosted JSON feed |
| `opencode`, `opencode-go` | `OPENCODE_API_KEY` or a stored key | Hosted JSON feed |
| `github-copilot` | GitHub device sign-in, or a bearer token in `COPILOT_GITHUB_TOKEN` | Hosted JSON feed, filtered by the account's model IDs |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN` or a stored key | Hosted JSON feed |
| `openrouter` | `OPENROUTER_API_KEY` or a stored key | Hosted JSON feed |

Anthropic workload identity federation needs `ANTHROPIC_FEDERATION_RULE_ID`,
`ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN_FILE`. `ANTHROPIC_SERVICE_ACCOUNT_ID` and
`ANTHROPIC_WORKSPACE_ID` are optional.

Clients fetch the catalog file for each provider from the R2 bucket at
`DEFAULT_MODELS_CATALOG_URL` and cache it in `~/.nyte/models-store.json`. To rebuild and upload the
catalogs, run:

```sh
pnpm --dir packages/ai models:generate
pnpm --dir packages/ai models:publish
```

`models:generate` writes one JSON array per provider under `catalog.generated/`, and
`models:publish` uploads those files to the `nyte-models` R2 bucket with `wrangler`. Before you
publish, run `wrangler login` or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/models.ts` | `Provider`, `Models`, `createProvider`, auth resolution, hosted catalog refresh and caching |
| `src/auth/` | Credential types and stores, API-key helpers, and the OAuth flows under `auth/oauth/` |
| `src/api/` | Wire adapters for Anthropic Messages, OpenAI Responses and Chat Completions, Codex and Google |
| `src/providers/` | Provider factories and provider-specific account filtering |
| `src/providers/nyte-catalog.ts` | The provider list and default models each client starts from |
| `scripts/` | Hosted catalog generation and R2 publishing |

## Credential storage

`FileCredentialStore`, which `createNyteModels` uses, keeps one credential per provider in
`~/.nyte/auth.json`. Several processes can write that file at once. Every change takes
`auth.json.lock` and holds it across the whole read-modify-write, including the OAuth refresh that
`Models` runs inside `modify`. A rotating refresh token is then spent once, not once per client.

A host from `openHost` in `@nyte-ai/host` keeps logins in its own store instead, through
`credentialStore` from `@nyte-ai/host/credentials`.

The lock names its owning process, host and acquisition. When a client on this machine crashes,
the next client takes over its lock at once. Any lock older than a minute is reclaimed even if a
process still claims it, because pids get reused and a suspended machine wakes with held locks. A
refresh interrupted this way costs the user a sign-in, so refreshes time out well before a minute.
A holder whose lock was reclaimed reports that it wrote nothing instead of overwriting the new
holder's work.

Writes publish by renaming a temporary file over `auth.json`, so readers take no lock and never see
a half-written file. A file that can't be read fails the operation instead of reading as empty.
This holds even for providers that would otherwise fall back to an environment variable, so a typo
in `auth.json` never overwrites every stored login. This version reports entries it can't parse as
no credential and leaves them on disk, so a downgrade can't drop credentials a newer build wrote.

## GitHub Copilot

The OAuth flow follows
[Pi at `71dca871`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/ai/src/auth/oauth/github-copilot.ts):

```text
Host starts GitHub device authorization
  -> UI displays verification URL and code
  -> host polls GitHub for its access token
  -> host exchanges that token at /copilot_internal/v2/token
  -> host fetches /models with the Copilot session token
  -> credential store saves both tokens and account model IDs
```

The credential stores the GitHub token in `refresh` and the short-lived Copilot session token in
`access`. `expires` is the session token's real expiry, and shared auth resolution refreshes five
minutes early under the credential store lock. A refresh repeats the exchange and the account model
lookup without another device login. A failed lookup saves neither a partial login nor a partial
refresh. Credential reads validate both tokens, the expiry and the account model IDs through one
schema. An incomplete credential or an old direct-token credential needs a fresh sign-in.

### Client identity

Sign-in uses GitHub's Copilot OAuth client, `Iv1.b507a08c87ecfe98`, with Copilot's editor headers.
This is not Nyte's own OAuth app, and the device-code instructions say so. The `clientId` option or
`NYTE_GITHUB_COPILOT_CLIENT_ID` selects another client, but that client must be allowed to use
Copilot's token exchange. A successful GitHub device grant doesn't prove that it is. Nyte is not an
official Copilot client.

### Security

- The session token's `proxy-ep` chooses the API origin. The host accepts only HTTPS origins under
  `*.githubcopilot.com` on the default port, and an untrusted origin fails before the session token
  leaves the host.
- A token without `proxy-ep` uses `https://api.individual.githubcopilot.com`.
- Requests refuse redirects and time out after 15 seconds, including reading the body.
- Errors carry the HTTP status or a known OAuth error code. They never carry remote response
  bodies or transport messages that contain tokens.
- Device polling can be cancelled and stops when the code expires.
- Verification URLs must point to a GitHub HTTPS login page.

### Model definitions and account access

The hosted catalog supplies Copilot endpoint routes, limits, reasoning controls and prices. The
authenticated `/models` response supplies which models the account can use. A known model stays
in the list when `/models` omits `supported_endpoints`, limits or billing data. An unknown model ID
waits for a catalog update and never gets a guessed route.

`getModels()` returns the cached hosted definitions. `getAvailable()` applies the account's
`availableModelIds`. Those IDs live with the credential, so another client can restore them
offline. Login and token refresh replace the list, even with an empty one. Models with a disabled
policy or no tool support are excluded. When every picker flag is false, only the Individual
endpoint falls back to models whose policy is enabled. Nyte never enables a model policy for you.
It reports that the account needs approval and leaves those models unavailable until you enable
them.

Catalog prices estimate model rates. They don't calculate Copilot subscription charges or
premium-request usage.

### Browser and server hosts

Use the narrow package entries instead of the main index, which also exports Node file stores:

```ts
import { InMemoryCredentialStore } from "@nyte-ai/ai/auth/credential-store";
import type { AuthInteraction } from "@nyte-ai/ai/auth/types";
import { createModels } from "@nyte-ai/ai/models";
import { githubCopilotProvider } from "@nyte-ai/ai/providers/github-copilot";

const credentials = new InMemoryCredentialStore();
const models = createModels({ credentials });
models.setProvider(githubCopilotProvider());

async function connect(interaction: AuthInteraction) {
  await models.refresh({ providers: ["github-copilot"] });
  await models.login("github-copilot", "oauth", interaction);
  return models.getAvailable("github-copilot");
}
```

`@nyte-ai/ai/auth/oauth/github-copilot` exposes the fetch-only flow directly. Both entries accept
an injected `fetch` and need no terminal, browser opener, callback listener or file system. The
tests run this login without Node globals against a simulated HTTP boundary. They don't show that
GitHub's CORS policy allows the requests from a browser.

In a web application, keep both tokens and the credential store on the server. Send the browser
only the device-code instructions, progress and safe completion details. The server polls and
refreshes, and the browser's cancel action aborts the signal the host owns. Use a durable
`CredentialStore` that keeps each user apart instead of the in-memory store in the example. Never
share one user's credentials across tenants.

The API-key method accepts `COPILOT_GITHUB_TOKEN`, a stored bearer token or an explicit request
token for headless hosts. It passes the token through as it is. It doesn't exchange or refresh the
token or look up the account's model IDs, so you must supply a token the Copilot API accepts. Use
OAuth to get token exchange, expiry handling and account filtering.

The integration doesn't support GitHub Enterprise domains or turn on model policies for you. It
has not been checked live with a fresh sign-in and an inference request.

## Account usage windows

The Claude and Codex account-limit fetchers report the percentage used and the reset time of each
window, apart from token consumption. For Claude, they read the 5-hour and weekly buckets and the
model-specific `weekly_scoped` entries in the response's `limits` array. Scoped windows use
`seven_day_<display_name>` IDs and `<display_name> weekly` labels. The fetchers omit missing or
malformed windows, and a missing reset time stays unknown. Requests can be cancelled up to the end
of the response body.

## Development

```sh
pnpm --dir packages/ai test
pnpm --dir packages/ai typecheck
```

The tests live in `test/` and run with Vitest. Transport tests inject HTTP or WebSocket fixtures at
the network boundary and exercise the real adapters, so they need no provider credentials and make
no live API calls.
