# TUI

- Terminal rendering and keyboard interaction live here; session behavior belongs in core.
- The interactive app is a Solid app on `@opentui/solid`, started by `runTui` in `src/app/main.tsx`. Print mode (`print.ts`, `print-invocation.ts`) and the CLI (`index.ts`, `flags.ts`, `run.ts`) stay outside it.
- `bun scripts/build-binary.ts` compiles with the Solid plugin through `Bun.build`; from source, `src/binary.ts` installs the same transform before loading the app.

## Architecture

One loop: `dispatch(msg) → reduce(state, msg, now) → { state, effects }`, then `deriveScreen(state)` for components and the runner for effects, whose results come back as messages.

- `src/model/`: pure. `reduce.ts` is the only writer of `State` (`state.ts`); `screen.ts` derives everything shown; `msg.ts` and `effect.ts` are the vocabularies; dialogs are values in `model/dialogs/`.
- `src/effects/`: IO as handlers, one per `Effect` kind in `runner.ts`. Ports (`ports.ts`) are the only way out; `host-port.ts` is the SDK adapter.
- `src/ui/`: components. They read `useApp().screen()`, send `dispatch(intent)` and draw with the kit; they decide nothing.
- `src/app/`: wiring: renderer, store, keymap layers, sinks, tickers, crash hooks.
- `src/lib/` (pure helpers) and `src/services/` (IO behind ports).

What Enter, Ctrl+Enter, Esc and Ctrl+C do is the situation table in `src/model/interactions.ts`; hints, placeholder and help read the same record. Change a key's behavior there, not in a handler. Shortcuts and keycaps are defined in `src/lib/constants.ts` (`CHAT_KEYBINDS`); production and QA reference them by name.

Boundary rules, enforced by `test/boundaries.test.ts`:

- `model/` imports no Solid, OpenTUI, `node:*`, effects, services, ui or app, and the SDK only as types (`@nyte-ai/plugin/question` excepted).
- `ui/` imports no effects or services, and the SDK only as types.
- Only `effects/host-port.ts` imports SDK values.
- No `setFrameCallback` and no raw `keyInput` listeners; keys go through `@opentui/keymap` layers.

Local input paints before host work: notices, the chosen model and level, and the composer's text change in `reduce` at once. Until the session is open, keys are refused with the `blocked` reason.

Native resources (`SyntaxStyle`, `TextBuffer`) take `renderer.nativeScene` as owner; layout reads use `getComputedLayout()`.

## Storage

- SQLite runs through `WorkerStore`; usage history runs through the host package's `UsageScanWorker`. Both stay off the rendering thread; `scripts/build-binary.ts` embeds their entries.
- Each workspace has one store at `~/.nyte/workspaces/<path-hash>/sessions.db` (`workspaceStorePath` in `@nyte-ai/host`). The TUI attaches as runner only to sessions it opened; children follow their parent.

## Tests

- Unit: `bun test` with `testRender` from `@opentui/solid` and helpers from `@opentui/core/testing` (`bunfig.toml` preloads the Solid transform). Model tests are plain functions over `test/fixture/view.ts`; effect tests run the runner over `fakeHost`/`fakePorts`; app tests run a real in-process host (`test/fixture/host.ts`).
- End to end: two scenarios in `qa/` against the compiled binary: `headless` (piped CLI) and `tui` (a real PTY observed with OpenTUI's `EmbeddedTerminalRenderable`). Assert visible screens, provider requests, process outcomes and clean exit output; never import the app into QA. Wait for observable states with deadlines and close every process, PTY, renderer and fixture.

## Verification

From the repository root:

- Unit tests: `pnpm --dir packages/tui test:unit`.
- Unit tests, build and both QA scenarios: `pnpm --dir packages/tui test`; one scenario with `--scenario headless` or `--scenario tui`.
- Visible PTY playback: `pnpm --dir packages/tui test:show` (add `--step` to advance with Enter).
- Types: `pnpm --dir packages/tui typecheck`. QA needs ripgrep 12 or later on PATH.
