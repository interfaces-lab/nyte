# Conversation

## Desktop

`packages/desktop/e2e/chat.spec.ts` uses the offline scripted prompts listed in `packages/desktop/e2e/README.md`.

- Send: "a new chat is created by its first message, answered and named".
- Follow-up: "a follow-up appends to the open chat" needs the previous test's chat.
- Stop: "a held response can be stopped" sends `/hold`, clicks `Stop response` once `Holding` shows, then expects `Echo: After stopping`. It checks no persisted run state or notice; extend it, within scope, for what a claimed fix needs.
- Attach: `composer.spec.ts` › "an attached image starts a new chat with its first message" stubs `dialog.showOpenDialog`, attaches a PNG, and expects `Echo: <text>[File Image 1, <bytes> bytes, image/png]` and the `Image 1` thumbnail. The byte count proves the host stored the upload.
- Upload failures show only in a browser engine. Node's fetch streams request bodies over HTTP/1.1 and Chromium does not, so SDK unit tests cannot stand in.

## Web

`packages/app/e2e/web/chat.spec.ts` › "a new chat shows the reply and takes its title from the provider" expects the same reply and URL after reload. Use the web project for reload.

## Gotchas

- `/hold` emits once, so silence after Stop proves nothing. Require settled run state or an accepted next turn. The host ends a stopped run within 3 s even when its tool ignores the signal.
- Only the app's `composer-states.electron.test.ts` checks the stopping state the composer shows from the press until the host's run takes over.
