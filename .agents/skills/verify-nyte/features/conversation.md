# Conversation

A user opens a workspace, sends a prompt, watches the reply stream in, can stop it, and finds the session again after reload.

## Sub-features

- `send`: composer submits a prompt and the transcript shows it at once.
- `stream`: the reply renders as it arrives, including markdown and code.
- `stop`: a held reply can be stopped and the composer becomes usable again.
- `attach`: an image attached in the composer is uploaded and sent with the message.
- `resume`: reload or reopen shows the same session.

## How to get to it (user POV)

- Web app: open the app, pick or create a session, type in the composer.
- Desktop: same screens over Electron IPC.

## Driving it with Playwright

Desktop uses `packages/desktop/e2e/chat.spec.ts` and the offline scripted catalog. The shared
`packages/desktop/e2e/ui.ts` helpers find the composer by role `combobox` and name `Message`, and the
transcript through region `Messages` and its `log`.

- Send: `send(page, "Hello desktop")`; expect paragraphs `Hello desktop` and
  `Echo: Hello desktop`, the selected chat tab, and its sidebar row.
- Stream and stop: the held-response case sends `/hold`, expects `Holding` and a running
  indicator, then clicks `Stop response`. Its final assertions hide Stop and show Send.
- Follow-up: the next send should append `And again` and `Echo: And again`.
- Attach: `composer.spec.ts` › "an attached image starts a new chat with its first message" opens
  a folder by stubbing `dialog.showOpenDialog`, picks a PNG through Add to message › Attach Files…,
  and expects `Echo: <text>[File Image 1, <bytes> bytes, image/png]` plus the `Image 1` thumbnail.
  The echo's byte count proves the host stored the upload. Uploads only fail in a browser engine:
  Node's fetch streams request bodies over HTTP/1.1, Chromium does not, so SDK unit tests cannot
  stand in for this case.
- Web reload: `e2e/web/chat.spec.ts` sends `hello` through the field labelled `Message`, saves
  the session URL, reloads, and expects the same reply and URL. Use the web project for this
  case; its echo fixture and selectors differ from desktop.

## Gotchas

- Desktop follow-up and held-response stop are unconditional `test.fixme` cases at audit time.
  They are documented journeys with assertions, but a green chapter does not prove either one.
- The stop case does not assert a notice or persisted cancellation. Add the observation needed
  by the claimed fix in that owning case, within the task's authorized scope.
- `/hold` emits once and stays silent before cancellation. Require settled run state or an
  accepted next turn when proving Stop, because silence alone cannot establish cancellation.
- Outside CI the harness reuses any server on `E2E_ORIGIN`; run the doctor.
