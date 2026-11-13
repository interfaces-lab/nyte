# Provider sign-in

Sign-in starts from the TUI's `/login`, `nyte login`, or Settings › Models › Connect Provider on desktop and web. `/accounts` in the TUI switches accounts.

- Desktop and web send `browser: "host"` or `"elsewhere"` with `models.login`, picked from the endpoint hostname. `localhost`, `127.0.0.1` and `[::1]` are local, so a tunnel to a remote host counts too.
- With `elsewhere`, Anthropic uses copy-code and OpenAI Codex device code, so desktop and web skip the provider's method question. `nyte login` sends `elsewhere` under `--no-open` or without a browser.
- The first account is named "Account 1" without a prompt. The TUI and CLI prompt for later accounts' names, which `nyte login --label` skips. The name is `models.login`'s `label`.

## Tests

- Host naming, steps, cancel: `pnpm --dir packages/core exec vitest run test/models.test.ts` and `pnpm --dir packages/ai exec vitest run test/models-runtime.test.ts`.
- Provider method choice: `pnpm --dir packages/ai exec vitest run test/anthropic-oauth.test.ts test/openai-codex-oauth.test.ts`.
- Wire: `pnpm --dir packages/host exec vitest run test/serve/client.test.ts` round-trips a `label` through `models.accounts`. No wire test sends `browser`.
- TUI dialog frames: `cd packages/tui && bun test test/ui/dialogs/auth.test.tsx test/app/app.test.tsx`.
- Desktop and web in real Electron, no app build: `pnpm --dir packages/app exec vitest run src/settings/models-settings-login.electron.test.ts`. Its bridge, `src/settings/fixtures/login-harness-bridge.ts`, scripts steps with `step(...)`, records `models.login` input, `login.answer` codes and `host.openExternal` calls; `setEndpoint(url)` picks a local or remote host.
- TUI `/accounts` and API-key `/login` journeys: `cd packages/tui && bun test test/app/menus.test.ts test/app/app.test.tsx`.

Prove a sign-in change with the action, the visible step, the recorded `models.login` input or answered code, and the saved `models.accounts` label.

## Gotchas

- No runner reaches a real provider. Only the ai tests, with stubbed `fetch`, prove OAuth flows. Say so when reporting.
- The Electron harness fakes the host; pair it with the core test for a saved account.
- With no web e2e sign-in journey, a remote-host claim must name the harness's `setEndpoint` test.
