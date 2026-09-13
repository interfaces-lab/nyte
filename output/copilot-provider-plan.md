# Copilot and provider connections in Nyte

Status: proposed plan. No Copilot implementation changes have been made.

## Recommendation

Add Copilot through Nyte's existing provider factories. Add a shared, host-owned provider connection service so terminal, desktop, and HTTP clients use the same login and catalog behavior. Do not move credentials into the conversation kernel or replace Nyte's runtime with the Copilot SDK.

Start with GitHub.com and one account per provider per host. Include remote catalog access and headless server credentials in the first release. Interactive remote login can follow on long-lived, explicitly managed hosts. Enterprise deployments and multiple accounts need separate acceptance criteria.

## Research baseline

OpenCode reference: `anomalyco/opencode`, branch `v2`, commit [`1c723c56fa942ec45f662abb1367a8d789acf071`](https://github.com/anomalyco/opencode/tree/1c723c56fa942ec45f662abb1367a8d789acf071).

This revision uses `packages/core`, `packages/server`, and integration services, not the older `packages/opencode/src/provider` layout. Source was inspected in a temporary checkout; its dependencies were not installed.

The locally resolved Nyte binary is the checkout's `bin/nyte`, version `0.0.2`. Matching installed documentation was absent from the npm, native-cache, and native-installer candidates. Nyte checkout documentation was read as project source, not as installed-version documentation. Real credentials and `.env` files were not read.

### What OpenCode v2 does

- Separates provider/catalog behavior from authentication integrations. Integrations advertise methods; connection records identify configured credentials; OAuth attempts track an unfinished login. Methods include OAuth, keys, environment, and commands. See [integration service](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/integration.ts#L51-L223).
- Stores credentials transactionally and supports selecting an active credential. Credential-switch events trigger account-dependent catalog refresh. See [credential service](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/credential.ts#L98-L193).
- Copilot uses GitHub device authorization, then checks `/copilot_internal/user` for entitlement and the account's API endpoint. It sends the GitHub OAuth token directly to the Copilot API. This revision does not perform the historical `/copilot_internal/v2/token` exchange. See [Copilot authorization](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/plugin/provider/github-copilot.ts#L15-L153).
- Fetches authenticated `/models`. It uses policy, advertised endpoints, limits, vision, reasoning, and billing metadata rather than treating every model as Chat Completions. See [catalog reconciliation](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/github-copilot/models.ts#L76-L205).
- Adds Bearer authorization and request metadata, including `X-GitHub-Api-Version`, `Openai-Intent`, vision, initiator, interaction type, and session identity. Subagent, title, and compaction calls are distinguished from ordinary agent turns. See [request adaptation](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/plugin/provider/github-copilot.ts#L248-L444).
- Maintains Copilot-specific Chat Completions and Responses adaptations. These include opaque reasoning, encrypted reasoning replay, stateless requests, response item IDs, and tool strictness. See [adapter notes](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/core/src/github-copilot/README.md).

Borrow these boundaries and observable behaviors, not OpenCode's entire plugin system, Effect implementation, database schema, client identity, or API adapter fork. OpenCode also resolves executable provider packages and supports command-based authentication. Neither belongs in Nyte's remotely editable provider configuration.

### What Nyte already has

| Area | Current behavior | Work needed |
| --- | --- | --- |
| Provider registration | Explicit `Provider`, `createProvider`, and `MutableModels` factories | Add Copilot, not another registry |
| Auth | Injectable `AuthContext`, credential stores, provider-owned `AuthInteraction` | Represent non-refreshable OAuth honestly; keep token types distinct |
| Device authorization | Shared polling helper and TUI device-code presentation | Copilot flow, bounded lifetime, desktop presentation |
| Transport | Copilot branches already exist in all three relevant adapters | Verify current wire requirements and multi-turn behavior |
| Models | Dynamic refresh, persistence, generation-checked publication | Authenticated, account-specific authoritative catalog |
| Desktop | Local catalog and browser/API-key login | Generic prompts, device codes, cancellation, correct remote catalog |
| Server | Authenticated request handler over a fixed SDK | Inject host provider operations; keep credentials out of core |
| Deployment | Custom environment and in-memory stores supported | Shared injectable provider composition and explicit credential policy |

Local references: [AI provider contract](../packages/ai/src/models.ts), [auth contract](../packages/ai/src/auth/types.ts), [default catalog](../packages/ai/src/providers/nyte-catalog.ts), [desktop catalog](../packages/desktop/src/main/catalog.ts), [TUI auth](../packages/tui/src/auth.ts), [server](../packages/server/README.md), [protocol](../packages/protocol/README.md), and [server demo composition](../packages/demo/server/host/src/index.ts).

Two existing problems should not be carried into a larger provider system:

1. `FileCredentialStore` serializes per provider within one instance, but rewrites the entire file from a snapshot taken before an awaited mutation. Concurrent writes to different providers can erase each other. Different desktop/TUI instances also lack a shared lock. A temporary-store probe reproduced the first problem: two completed provider writes left only one provider. Parsing currently trusts JSON through an assertion and treats every read failure as an empty store.
2. Desktop login ignores `device_code` notifications and answers every selection prompt with `browser`. Its catalog also uses local models for remote sessions. Simply registering Copilot would leave these paths broken.

## Proposed ownership

```text
Terminal UI / desktop UI / remote browser
                  |
        direct calls / IPC / HTTP
                  |
       host provider connection service
          |                  |
    auth attempts       public catalog
          |                  |
       AI providers + credential/model stores
                  |
           GitHub / Copilot API

Conversation core receives selected models and a stream function.
It does not receive OAuth attempts or stored secrets.
```

### AI package

Keep provider mechanics here: authentication, entitlement lookup, endpoint validation, model parsing, and transport adaptations.

- Add `githubCopilotProvider` and a fetch-based device authorization flow. Use top-level imports. The Copilot flow does not need a Node callback server or another dynamic loader.
- Extend OAuth credentials with an explicit non-refreshable access-token variant alongside refreshable credentials. Do not manufacture a refresh token or expiry merely to satisfy today's interface. Parse the token response, including expiry and refresh fields if the chosen OAuth application returns them. Apply refresh only to refreshable credentials.
- Preserve existing auth precedence: explicit host request overrides, then stored credentials, then environment. A rejected stored token must not silently switch accounts by falling back to an environment token.
- Keep `checkAuth` a configuration check. Report entitlement or network verification separately; a stored OAuth token is not proof that Copilot access still works.
- Make model discovery consume resolved request authentication, including endpoint and headers. Today's refresh context passes credential material, and the environment path can lose `AuthResult` endpoint/header information. Catalog requests and inference must use the same account resolution.
- Add injectable options to shared Nyte provider composition. Local clients retain file-backed defaults; servers supply stores, an allowlisted `AuthContext`, provider configuration, and network access. Servers should not copy their own incomplete provider list.

### Host package

Add a `@nyte-ai/host/providers` subpath. No new workspace package is necessary.

It owns public catalog projection, connection status, login attempts, cancellation, disconnect, and catalog invalidation. Client-specific hidden models and enabled switches remain client preferences.

Keep three things separate:

- Provider identity, such as `github-copilot`.
- Configured access, including source, account/deployment label, whether Nyte can remove it, and last verification result.
- A temporary login attempt with its own ID and expiry.

The first implementation still stores one credential per provider. Do not introduce account switching, credential sharing between provider IDs, or multi-tenant access under the guise of Copilot support. OpenCode's broader integration model is a reference for those later requirements.

### Protocol, server, and client

Add a separate host-operation contract rather than inserting login into core's SDK dispatch. Suggested operations:

```text
provider.catalog
provider.catalog.refresh
provider.auth.start
provider.auth.status
provider.auth.reply
provider.auth.cancel
provider.disconnect
```

Use bounded, versioned attempt snapshots for initial remote login support. Each snapshot can describe the current prompt, device code, progress, or terminal result. An event stream is optional later; session SSE is not an authentication event log.

- Protocol owns plain DTOs and boundary schemas. Keep Node, AI implementations, and host implementations out of it.
- Server accepts an injected provider-service interface. Existing consumers without it keep working and report that provider management is unavailable.
- Client exposes typed calls with `AbortSignal`. An HTTP request ending cancels only that request, not a login that the host already accepted.
- Provider management is disabled unless the embedding host explicitly enables and authorizes it. A credential allowed to chat must not automatically be allowed to replace the host's provider credentials.
- First release remains one trusted owner per host. Full tenancy requires server-derived identity, separate SDKs/stores, and attempt ownership checks. Today's allow/deny auth hook does not supply that isolation.
- Preserve origin checks, body limits, schema validation, and sanitized errors. Require TLS for remote credential submission, normally through the deployment's proxy, and rate-limit authorization starts and polling. Credential operations and attempt snapshots must be non-cacheable. Never return stored tokens through status, catalog, session events, or diagnostics.

### Clients

- TUI and desktop use the shared host service while retaining their own rendering.
- Desktop supports provider-owned text/select/secret/manual-code prompts and structured device-code instructions. It needs visible copy/open actions, expiry, retry, and cancel. No automatic `browser` answer.
- Local sessions use local provider state. Remote sessions use the remote host's catalog and capabilities. A local Copilot login must not imply that the server is connected.
- A remote connection failure is not an empty model catalog. A server disconnect must not route a formerly remote session to the local SDK.
- Keep `nyte login github-copilot` as the terminal entry point. Non-interactive inference uses preconfigured credentials and never starts an interactive login unexpectedly.

## Copilot behavior to implement

### Authorization and token lifetime

1. Request a device/user code from GitHub.
2. Present the verification URL and user code. Keep the device secret on the host.
3. Poll through the shared helper, respecting `authorization_pending`, `slow_down`, expiry, denial, and cancellation. Bound the HTTP requests as well as the overall attempt.
4. Parse the OAuth credential. Check Copilot entitlement and validate the discovered API origin.
5. Persist only after successful authorization. An explicit entitlement denial must not report a connected provider. A temporary lookup failure remains an unverified state, not a claim that the account has no subscription.
6. Refresh the account's model catalog before declaring models ready. Report a catalog failure separately from a successful credential save.

GitHub's [device-flow documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) requires a client ID and device-flow-enabled application, but no client secret or callback listener. The selected app may issue expiring tokens; verify its actual configuration.

GitHub [announced official OpenCode support on January 16, 2026](https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/). OpenCode currently embeds client ID `Ov23li8tweQw6odWQebz`. Its integration is not evidence that Nyte can reuse its identity or receive the same access.

First verify a Nyte-owned application's access to the direct endpoints and intended subscription models. Confirm allowed scopes, headers, API versions, token types, and billing semantics. Official [Copilot SDK OAuth documentation](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth) supports user OAuth through the SDK; that alone does not establish a supported contract for every internal endpoint used by OpenCode.

### Model discovery and transport

Use authenticated `/models` as the authoritative account catalog after a successful refresh, not an additive overlay that keeps removed baseline models available. Preserve the last valid catalog on transient failures, and expose that it is stale.

- Map advertised `/v1/messages`, `/responses`, and `/chat/completions` endpoints to Nyte adapters. Do not infer the API solely from `claude-*` or `gpt-*` names.
- Filter policy-disabled and unsupported models. Respect picker availability, tool support, streaming, limits, images, and advertised reasoning levels. Unknown endpoints must not silently use a guessed transport.
- Account replacement and deployment changes invalidate discovery even inside the normal four-hour freshness window. Cached availability must not leak across accounts. Publication must reject stale work after login, logout, or replacement.
- Keep endpoint origins in auth and API paths in transport. Nyte's installed Anthropic SDK already posts to `/v1/messages`; copying OpenCode's `/v1` base path would risk doubling the prefix.
- Test Copilot headers at the outbound request boundary, with Bearer auth and no competing `x-api-key`. Use Nyte's identity unless a verified vendor requirement says otherwise. Do not copy stale VS Code identity headers from the dormant generator.
- Carry request purpose from the host where necessary. A child task's initial user-shaped message is still agent-initiated; compaction and title requests are not ordinary user turns. Keep Copilot-specific header spelling out of core.
- Verify multi-turn tool calls, opaque Chat Completions reasoning, encrypted Responses reasoning, response item ID handling, strictness, cancellation, usage, and error mapping. Existing Copilot branches are partial support, not proof of compatibility.
- Do not label subscription access as unlimited or free. Validate Copilot billing units before converting to USD; absent pricing is unknown, not zero-cost usage. No copied native Anthropic/OpenAI rate table.

Do not add the old token exchange as an automatic fallback unless a verified deployment requires it. A fallback can change accessible models and account semantics.

## Environment and deployment plan

The names below are proposals except where marked existing.

| Configuration | Needed? | Owner and meaning |
| --- | --- | --- |
| `NYTE_TOKEN` | Existing HTTP deployment convention | Client-to-Nyte bearer token. Never a Copilot token |
| `NYTE_HOME` | Existing, optional locally | Shared local credential/catalog directory; not durable serverless storage |
| `NYTE_MODEL` | Existing host/CLI convention | Exact `github-copilot/<model-id>` selection |
| `COPILOT_GITHUB_TOKEN` | Optional, proposed for headless use | Explicit Copilot-capable GitHub token supplied by the operator, subject to the verified integration contract. Not a promise that arbitrary PATs or CI tokens work. No automatic `GH_TOKEN` or `GITHUB_TOKEN` fallback |
| `NYTE_COPILOT_CLIENT_ID` | Optional override once Nyte has a default app; required in a development spike without one | Public OAuth client configuration, not a secret |
| Enterprise host configuration | Only if Enterprise is included | Prefer parsed provider options. An environment alias can follow when its deployment contract is settled |
| OAuth client secret | Not needed for the proposed device flow | Do not add one by default |
| OAuth callback URL/port | Not needed for Copilot device flow | Browser approval and host polling work on different machines |

Split server composition into client authentication and provider environment. Do not give providers the whole `process.env` or a secret map containing `NYTE_TOKEN`. Parse an allowlist at composition; do not mutate process environment from an HTTP connection request. Never embed these tokens in renderer/public build variables.

Normal local login needs no user-supplied environment once Nyte has a working application ID. Headless servers choose either operator-supplied credentials or a durable credential store; neither should require copying desktop auth files implicitly. Removing a stored credential must report if an environment credential still provides access.

Deployment modes:

- Local desktop/TUI: shared file stores with validated data, safe writes, restrictive permissions, and cross-process serialization.
- Long-lived self-hosted server: injected durable store or explicit token environment. Interactive management is opt-in. The host owns login-attempt shutdown and expiry.
- Current ephemeral serverless demos: environment-only inference and catalog reads. Do not enable in-memory multi-request login attempts or save tokens to `/tmp`.
- Future serverless interactive login: durable attempt state, a worker or actor that owns polling, durable secret storage, and instance routing. Sticky routing alone is not durability. Multi-tenant deployments need separate tenant hosts as well.

Enterprise must not be a free-form server-side fetch target. Validate HTTPS origins, reject credentials/paths/query fragments, and constrain discovery and redirects. Public hosts must block arbitrary private-network targets; explicitly configured private Enterprise installations require a separate operator policy. GitHub.com, data-residency domains, and self-hosted Enterprise must not be assumed interchangeable.

## Login-attempt and storage rules

- One active credential mutation per provider within a host. Attempts have unguessable IDs, bounded retention, a generation, and prompt IDs.
- Start and reply mutations are idempotent. Duplicate delivery cannot restart authorization or answer a later prompt. Status reads have no mutation side effects.
- Client disconnect stops observation, not the accepted attempt. Explicit cancel, expiry, replacement, and host shutdown stop polling and pending prompts.
- Persist before reporting success. Cancel/logout must fence stale completion so a late result cannot reconnect a provider.
- Disconnect removes Nyte-owned credentials, not deployment environment. Do not imply that local deletion revokes the GitHub authorization; provide the upstream revocation location when appropriate.
- Fix file storage before expanding concurrent connections: validate records, distinguish missing from corrupt/unreadable files, serialize whole-file read-modify-write across instances/processes, use atomic replacement, and preserve the original on failure. Add bounded lock acquisition and cancellation. Do not hold the storage lock during user interaction.
- Do not log credential bodies, reply values, authorization headers, OAuth device secrets, or raw vendor error responses. Keep only safe status and operation identifiers.

## Delivery order

1. **Compatibility spike and decision.** Confirm the Nyte OAuth application, token lifetime, direct endpoint access, entitlement lookup, and a tool-call round trip on each advertised API. Use a consenting test account. Produce redacted fixtures. This is the release gate, not an excuse to reuse OpenCode's application ID.
2. **Credential and composition foundation.** Fix persistence races and boundary parsing. Add the explicit token lifetime variant and injectable shared provider composition. Keep existing Anthropic, Codex, OpenAI, and OpenCode behavior covered.
3. **Copilot provider.** Implement authorization, endpoint resolution, account-specific model discovery, and verified transport changes. Integrate the provider into package exports and the shared catalog. Add an AI README, which is currently missing.
4. **Shared local connection service.** Move local login/status/catalog orchestration behind the host service. Add desktop device-flow interaction and preserve TUI cancellation. Handle account changes and stale catalog publication.
5. **Server catalog and headless access.** Add host protocol contracts, injected server handlers, client methods, remote catalog selection, secret allowlists, and deployment documentation. A fresh environment-only host must discover models before resolving its configured Copilot model; today's offline-only `resolveModel` is insufficient for an empty dynamic catalog.
6. **Opt-in remote login.** Add idempotent auth attempts, explicit management authorization, cancellation, expiry, and remote client presentation for long-lived hosts. Keep unsupported serverless deployments read-only. Enterprise and multiple accounts remain separate work unless explicitly included.

Steps 1-5 form the recommended first release. Step 6 is not required to run Copilot behind `@nyte-ai/server`.

## Verification

Test observable behavior with temporary stores and controlled HTTP endpoints, not source-string assertions or mocks of private helpers.

- Authorization: pending, slow-down, denial, expired code, malformed response, hung request, cancellation, no entitlement, transient verification failure, token revocation, and token rotation where applicable.
- Storage: reload after login, concurrent providers, separate instances/processes, login versus logout, cancelled commit, atomic write failure, invalid JSON, and restrictive permissions.
- Catalog: advertised endpoint mapping, removed models, disabled policy, malformed entries, stale/offline cache, account replacement, fresh server startup, and logout during discovery.
- Transport: one real adapter tool-call round trip per supported API, image input, reasoning replay across multiple turns, host request purpose, correct headers/path, safe errors, and cancellation.
- Clients: desktop device-code visibility and cancel; TUI cleanup; environment-backed disconnect receipts; remote sessions use only remote models; lost HTTP replies are safe to retry; server disconnect never falls through locally.
- Security: provider management denied without its explicit capability, secret-free outputs, non-cacheable attempt state, rejected untrusted endpoints/redirects, bounded payloads, and shutdown cleanup.

Run affected package tests for AI, host, protocol, client, server, desktop, and TUI according to their package scripts and local instructions. Then run `pnpm typecheck`, `pnpm lint`, and `pnpm format`, reporting unrelated failures without fixing them. Test compiled TUI and desktop packaging so source-only OAuth success cannot hide a bundle failure. Live GitHub verification is an explicit acceptance check, not a routine CI test.

## Decisions needed before implementation

1. Confirm a Nyte-owned OAuth application and the acceptable support contract for direct Copilot API access.
2. Confirm the first release is GitHub.com, one account per provider, and local login plus headless server access. Recommended: yes.
3. Decide whether interactive remote login is required in that first release. Recommended: follow after the server catalog and credential policy are in place.
