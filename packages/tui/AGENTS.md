# TUI

- Terminal rendering and keyboard interaction live here; session behavior belongs in core.
- The interactive app is a Solid app on `@opentui/solid`, started by `runTui` in `src/app/main.tsx`. Print mode (`print.ts`, `print-invocation.ts`) and the CLI (`index.ts`, `flags.ts`, `run.ts`) stay outside it.
- `bun scripts/build-binary.ts` compiles with the Solid plugin through `Bun.build`, starting at `src/index.ts`, to bytecode so launch skips parsing; from source, `src/binary.ts` installs the same transform before loading the app.

## Architecture

One loop: `dispatch(msg) → reduce(state, msg, now) → { state, effects }`, then `deriveScreen(state)` for components and the runner for effects, whose results come back as messages.

- `src/model/`: pure. `reduce.ts` is the only writer of `State` (`state.ts`); `screen.ts` derives everything shown; `msg.ts` and `effect.ts` are the vocabularies; dialogs are values in `model/dialogs/`.
- `src/effects/`: IO as handlers, one per `Effect` kind in `runner.ts`. Ports (`ports.ts`) are the only way out; `host-port.ts` is the SDK adapter.
- `src/ui/`: components. They read `useApp().screen()`, send `dispatch(intent)` and draw with the kit; they decide nothing.
- `src/app/`: wiring: renderer, store, keymap layers, sinks, tickers, crash hooks.
- `src/lib/` (pure helpers) and `src/services/` (IO behind ports).

What Enter, Ctrl+Enter, Esc and Ctrl+C do is the situation table in `src/model/interactions.ts`; hints, placeholder and help read the same record. Change a key's behavior there, not in a handler. Shortcuts and keycaps are defined in `src/lib/constants.ts` (`CHAT_KEYBINDS`, and `FIELD_KEYBINDS` for the editing keys of a dialog's typed field, whose text and caret the dialog value holds); production and QA reference them by name.

Boundary rules, enforced by `test/boundaries.test.ts`:

- `model/` imports no Solid, OpenTUI, `node:*`, effects, services, ui or app, and the SDK only as types (`@nyte-ai/plugin/question/schema` and `@nyte-ai/plugin/client/presentation` excepted).
- `ui/` imports no effects or services, and the SDK only as types.
- Only `effects/host-port.ts` imports SDK values.
- No `setFrameCallback` and no raw `keyInput` listeners; keys go through `@opentui/keymap` layers.

Local input paints before host work: notices, the chosen model and level, and the composer's text change in `reduce` at once. Until the session is open, keys are refused with the `blocked` reason.

Native resources (`SyntaxStyle`, `TextBuffer`) take `renderer.nativeScene` as owner; layout reads use `getComputedLayout()`.

## Storage

- Every command but `nyte serve` reaches the host through the user's background service (`@nyte-ai/service`): `src/service.ts` finds or starts it (`nyte service run`, one per home through `~/.nyte/service.lock`, on a free port unless `NYTE_SERVICE_PORT` pins one) and connects with `sdk.connect`. The service runs every session and owns the Nyte Connect link that `nyte account` shares. `nyte serve` and `nyte service run` run the host on a worker thread: `src/hosting.ts` starts `src/host-worker.ts`, a separate bundle in the binary. The CLI's own graph (`src/index.ts`, the TUI and `@nyte-ai/sdk/client`) never imports `@nyte-ai/host`, so client commands start without loading providers or the store. Usage history runs through the host package's `UsageScanWorker`.
- Each workspace has one store at `~/.nyte/workspaces/<path-hash>/sessions.db` (`workspaceStorePath` in `@nyte-ai/host`). The TUI attaches as runner only to sessions it opened; children follow their parent.

## Tests

- `bun test` runs everything in process: model tests are plain functions over `test/fixture/view.ts`, effect tests run the runner over `fakeHost`/`fakePorts`, and UI tests use `testRender` from `@opentui/solid` (`bunfig.toml` preloads the Solid transform).
- App tests start the whole TUI with `startTui()` (`test/harness/tui.ts`): a test renderer whose clock is a `ManualClock`, `mountApp` over a real in-process host with `fakeModels` from `@nyte-ai/bench`, and fake local ports. `opened: false` holds the host closed, `typed` types before mount, and `until`/`frame` render until a condition holds or fail after a bounded number of turns with the last frame. Drive keys by command name with `press`, never by escape sequence.
- `qa/binary.smoke.ts` is the only test of the compiled binary: pipes and a PTY, against a service this process registers in an isolated HOME (`qa/service.ts`), so the binary connects to a real host over the fake provider. `qa/pty.ts` encodes keys with `EmbeddedTerminalRenderable.encodeKey` for the modes the binary negotiated. Keep it to what only the binary shows: startup, trust, exit codes and the resume text.

## Verification

From the repository root:

- Tests: `pnpm --dir packages/tui test`.
- The compiled binary: `pnpm --dir packages/tui test:binary` (builds `bin/nyte` first; set `NYTE_BINARY` to test another build).
- Types: `pnpm --dir packages/tui typecheck`.
