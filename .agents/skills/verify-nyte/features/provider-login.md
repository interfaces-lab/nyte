# Provider sign-in

Connect a model provider so its models can answer. The host runs the provider's login and stores the account. Each client shows the login steps and answers them: the TUI's `/login` dialog, `nyte login`, and Settings › Models › Connect Provider on desktop and web. `/accounts` in the TUI switches the active account.

- Desktop and web send `browser: "host"` or `"elsewhere"` with `models.login`. With `elsewhere`, Anthropic uses copy-code and OpenAI Codex uses device code instead of a localhost callback on the host, so desktop and web never show the provider's method question. `nyte login` sends `elsewhere` under `--no-open` or without a browser.
- The first account is saved as "Account 1" without a prompt. The TUI and CLI ask for a name only when the provider already has an account, and `nyte login --label` skips the question. The name travels as `models.login`'s `label`.

## Test runners

Fast loop from the repository root, seconds each:

- Host rules (naming, steps, cancel): `pnpm --dir packages/core exec vitest run test/models.test.ts` and `pnpm --dir packages/ai exec vitest run test/models-runtime.test.ts`.
- Provider method choice: `pnpm --dir packages/ai exec vitest run test/anthropic-oauth.test.ts test/openai-codex-oauth.test.ts`.
- Wire: `pnpm --dir packages/host exec vitest run test/serve/client.test.ts` runs a login with a `label` over HTTP and reads it back from `models.accounts`. No wire test sends `browser`.
- TUI dialog frames: `cd packages/tui && bun test test/ui/dialogs/auth.test.tsx test/app/app.test.tsx`.
- Desktop and web screen in real Electron: `pnpm --dir packages/app exec vitest run src/settings/models-settings-login.electron.test.ts`. It needs no app build. Its bridge, `src/settings/fixtures/login-harness-bridge.ts`, scripts steps with `step(...)`, records `models.login` input, `login.answer` codes and `host.openExternal` calls, and switches between a local and remote host with `setEndpoint(url)`.

Journey: `cd packages/tui && bun test test/app/menus.test.ts test/app/app.test.tsx`. "/accounts switches the login the next request uses, without asking the provider" seeds two labelled accounts and switches between them; "API-key login supports paste, select all, delete and repaste without exposing its value" drives `/login`. Both run the whole TUI over an in-process host.

Proof for a sign-in change: the action (click or keys), the visible step, the recorded `models.login` input or answered code, and the saved account label from `models.accounts`.

## Gotchas

- No runner reaches a real provider. The TUI tests answer with `fakeModels`, so only the ai tests, with stubbed `fetch`, prove the OAuth flows. Say so when reporting.
- The Electron harness replaces the host connection. It proves what the screen sends and shows, not that a real host saved the account; pair it with the core test.
- No web e2e journey covers sign-in. Only the harness's `setEndpoint` proves the web case, so a remote-host claim must name that test.
- Desktop and web pick `browser` from the endpoint hostname, reading `localhost`, `127.0.0.1` and `[::1]` as the host's own machine. A tunnel that forwards a remote host to a local port reads as local.
