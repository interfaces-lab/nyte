# Conversation

A user sends a prompt, watches the reply stream in, can stop it, attaches an image, and finds the session again after reload.

## Desktop

`packages/desktop/e2e/chat.spec.ts` runs over the offline scripted catalog; `packages/desktop/e2e/README.md` lists its prompts.

- Send: "a new chat is created by its first message, answered and named".
- Follow-up: "a follow-up appends to the open chat" sends into the chat the test before it created, so replay the chapter.
- Stop: "a held response can be stopped" sends `/hold`, waits for `Holding` and the tab's `Working` indicator, clicks `Stop response`, expects Stop hidden and Send shown, then expects `Echo: After stopping` for the next send. It attaches a screenshot and an accessibility snapshot.
- Attach: `composer.spec.ts` › "an attached image starts a new chat with its first message" opens a folder by stubbing `dialog.showOpenDialog`, picks a PNG through Add to message › Attach Files…, and expects `Echo: <text>[File Image 1, <bytes> bytes, image/png]` plus the `Image 1` thumbnail. The byte count proves the host stored the upload. Upload failures show only in a browser engine, because Node's fetch streams request bodies over HTTP/1.1 and Chromium does not, so SDK unit tests cannot stand in for this case.

## Web

`packages/app/e2e/web/chat.spec.ts` › "a new chat shows the reply and takes its title from the provider" sends `hello`, saves the session URL, reloads, and expects the same reply and URL. Use the web project for reload.

## Gotchas

- The Stop case checks the UI and the next turn, not the run's persisted state or a notice. Add the observation a claimed fix needs to that case, within the task's scope.
- `/hold` emits once and then stays silent, so silence after Stop proves nothing. Require settled run state or an accepted next turn. The host ends a stopped run within 3 s even when its tool ignores the signal.
- The composer shows stopping from the press until the host's run takes over. The app's `composer-states.electron.test.ts` checks that state; the desktop chapter does not.
- Outside CI the web harness reuses any server on its port; check the port first as SKILL.md says.
