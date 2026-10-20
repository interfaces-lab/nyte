# TUI

- Terminal rendering and keyboard interaction live here; session behavior belongs in core.
- The interactive app is a Solid app on `@opentui/solid`. `runTui` in `src/app/main.tsx` owns what lives as long as the process: the terminal, the renderer, the keymap, the host thread, local ports and signal and crash hooks. It mounts the app with `mountApp` from `src/app/mount.tsx`, whose `close()` releases everything the mount added and leaves the host open. Print mode (`print.ts`, `print-invocation.ts`) and the CLI (`index.ts`, `flags.ts`, `run.ts`) stay outside it.
- `bun scripts/build-binary.ts` compiles with the Solid plugin through `Bun.build`, starting at `src/index.ts`, to bytecode in `dist/nyte` so launch skips parsing. Builds never touch the `nyte` a terminal runs: only `pnpm install:nyte` copies `dist/nyte` to `~/.nyte/bin/nyte`; from source, `src/binary.ts` installs the same transform before loading the app.
- `pnpm dev:tui [directory]` runs `src/index.ts` from source with `dev/preload.ts`, in the directory given or the one pnpm ran in. `dev/reload.ts` replaces `src/app/mount.tsx` with a mount that loads it through Vite's module runner and remounts on save, carrying the followed chat and the draft. A failed reload keeps the running UI. Packages in its `DURABLE` list, the process's own files and the host's load once; a change to them says to restart. `NYTE_RELOAD=off` runs from source without reloading. A source run keeps its chats in `~/.nyte/nyte-dev.db`, so unfinished store changes never reach `nyte.db`; set `NYTE_DB` to choose another file. Nothing under `dev/` reaches the binary.

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

- Every command opens its own host on a worker thread over the shared `~/.nyte/nyte.db`: `src/local-host.ts` starts it through `src/hosting.ts` (`src/host-worker.ts`, a separate bundle in the binary) on a 127.0.0.1 port with a fresh token and connects with `sdk.connect`. Any number of nyte and Nyte.app processes share the store; each takes over runs whose process died (core's `engine/presence.ts`). A revoked host relaunches on the same port. Each host serves `@nyte-ai/service`'s Connect sharing routes, and one linked process at a time carries the relay. The CLI's own graph (`src/index.ts`, the TUI and `@nyte-ai/sdk/client`) never imports `@nyte-ai/host`, so client commands start without loading providers or the store. Usage history runs through the host package's `UsageScanWorker`.
- Each workspace has one store at `~/.nyte/workspaces/<path-hash>/sessions.db` (`workspaceStorePath` in `@nyte-ai/host`). The TUI attaches as runner only to sessions it opened; children follow their parent.

## Tests

- `bun test` runs everything in process: model tests are plain functions over `test/fixture/view.ts`, effect tests run the runner over `fakeHost`/`fakePorts`, and UI tests use `testRender` from `@opentui/solid` (`bunfig.toml` preloads the Solid transform).
- App tests start the whole TUI with `startTui()` (`test/harness/tui.ts`): a test renderer whose clock is a `ManualClock`, `mountApp` over a real in-process host with `fakeModels` from `@nyte-ai/bench`, and fake local ports. `opened: false` holds the host closed, `typed` types before mount, and `until`/`frame` render until a condition holds or fail after a bounded number of turns with the last frame. Drive keys by command name with `press`, never by escape sequence.
- `qa/binary.smoke.ts` is the only test of the compiled binary: pipes and a PTY, against a service this process registers in an isolated HOME (`qa/service.ts`), so the binary connects to a real host over the fake provider. `qa/pty.ts` encodes keys with `EmbeddedTerminalRenderable.encodeKey` for the modes the binary negotiated. Keep it to what only the binary shows: startup, trust, exit codes and the resume text.

## Verification

From the repository root:

- Tests: `pnpm --dir packages/tui test`.
- The compiled binary: `pnpm --dir packages/tui test:binary` (builds `dist/nyte` first; set `NYTE_BINARY` to test another build).
- Types: `pnpm --dir packages/tui typecheck`.
