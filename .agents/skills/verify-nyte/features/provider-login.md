# Provider sign-in

Connect a model provider so its models can answer. The host runs the provider's login and
stores the account; each client shows the steps (`open`, `paste`, `choose`, `waiting`, `done`,
`failed`) and answers them.

## Sub-features

- `tui`: `/login [provider]` opens the auth dialog under the composer: method choice, link with
  code, masked key field, waiting spinner. Esc cancels.
- `cli`: `nyte login <provider> [--method oauth|api_key]` prompts over readline on stderr.
- `desktop`: Settings › Models › Connect Provider. Browser sign-in, device code panel, or the
  API key form. The client picks the provider's default method itself and never shows its
  method question.
- `web`: the same Settings › Models screen against a remote host. The client sends
  `browser: "elsewhere"` with `models.login`, so Anthropic uses copy-code and OpenAI Codex uses
  device code instead of a localhost callback on the server.
- `accounts`: the first account is saved as "Account 1" without a prompt. The TUI and CLI ask
  "Label for this … account (optional)" only when the provider already has an account; the name
  travels as `models.login`'s `label`. `/accounts` switches the active account.

## How to get to it (user POV)

- TUI: type `/login`, pick a provider, follow the dialog.
- Shell: `nyte login anthropic`.
- Desktop or web: Settings › Models, a provider row's Connect Provider button.

## Driving it with the test runners

Fast loop, from the repository root. Each finishes in seconds:

- Host rules (naming, steps, cancel): `pnpm --dir packages/core exec vitest run test/models.test.ts`
  and `pnpm --dir packages/ai exec vitest run test/models-runtime.test.ts`.
- Provider method choice: `pnpm --dir packages/ai exec vitest run test/anthropic-oauth.test.ts test/openai-codex-oauth.test.ts`.
- Wire (`label` and `browser` cross HTTP): `pnpm --dir packages/protocol exec vitest run test/client.test.ts`.
- TUI dialog frames: `cd packages/tui && bun test test/ui/dialogs/auth.test.tsx test/app/app.test.tsx`.
- Desktop and web screen in real Electron:
  `pnpm --dir packages/app exec vitest run src/chrome/models-settings-login.electron.test.ts`.
  It builds its own harness; no app build is needed. The harness bridge
  (`src/chrome/fixtures/login-harness-bridge.ts`) scripts login steps with `step(...)`, records
  `models.login` input, `login.answer` codes and `host.openExternal` calls, and switches between
  a local and remote host with `setEndpoint(url)`.

Journey: build the TUI, then `node packages/tui/qa/run.mjs --scenario tui`. The beats
"/accounts chooses the login used by the next request" and "login fields paste, select all,
delete and accept a replacement key" drive `/login` and `/accounts` in the compiled binary.
The fixture seeds "Primary" and "Secondary" through `models.login` with `label`
(`qa/workspace.ts`).

Proof for a sign-in change: the action (click or keys), the visible step, the recorded
`models.login` input or answered code, and the saved account label from `models.accounts`.

## Gotchas

- No runner reaches a real provider. QA blocks network egress, so the OAuth flows are proven
  only by the ai tests with stubbed `fetch`. Say so when reporting.
- The Electron harness replaces the host connection. It proves what the screen sends and shows,
  not that a real host saved the account; pair it with the core test.
- No web e2e journey covers sign-in. The web case is proven only through the harness's
  `setEndpoint`; a remote-host claim needs that test named in the report.
- The client decides `browser` from the endpoint hostname (`localhost`, `127.0.0.1`, `[::1]`
  mean the host). A tunnel that forwards a remote host to a local port reads as local.
- In the TUI scenario an earlier failed beat stops the rest. A failure in a later beat such as
  `/quit` does not exercise sign-in; check which beat failed before blaming a login change.
