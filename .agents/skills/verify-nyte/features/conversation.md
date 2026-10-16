# Conversation

A user opens a workspace, sends a prompt, watches the reply stream in, can stop it, and finds the session again after reload.

## Sub-features

- `send`: composer submits a prompt and the transcript shows it at once.
- `stream`: the reply renders as it arrives, including markdown and code.
- `stop`: a held reply can be stopped and the composer becomes usable again.
- `resume`: reload or reopen shows the same session.

## How to get to it (user POV)

- Web app: open the app, pick or create a session, type in the composer.
- Desktop: same screens over Electron IPC.

## Driving it with Playwright

Desktop uses `e2e/desktop/chat.spec.ts` and the offline scripted catalog. The shared
`desktop/ui.ts` helpers find the composer by role `combobox` and name `Message`, and the
transcript through region `Messages` and its `log`.

- Send: `send(page, "Hello desktop")`; expect paragraphs `Hello desktop` and
  `Echo: Hello desktop`, the selected chat tab, and its sidebar row.
- Stream and stop: the held-response case sends `/hold`, expects `Holding` and a running
  indicator, then clicks `Stop response`. Its final assertions hide Stop and show Send.
- Follow-up: the next send should append `And again` and `Echo: And again`.
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
