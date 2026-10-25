# TUI

- Terminal rendering and keys live here; session behaviour belongs in core.
- A Solid app on `@opentui/solid`. `runTui` (`src/app/main.tsx`) owns process-long resources; `mountApp` (`src/app/mount.tsx`) mounts the app, and its `close()` leaves the host open. Print mode and the CLI (`index.ts`, `flags.ts`, `run.ts`) sit outside it.
- `pnpm dev:tui [directory]` runs from source with hot reload (`dev/reload.ts`; `NYTE_RELOAD=off` disables it) on `~/.nyte/nyte-dev.db` (`NYTE_DB` overrides). Only `pnpm install:nyte` replaces `~/.nyte/bin/nyte`. Nothing under `dev/` reaches the binary.

## Architecture

One loop: `dispatch(msg) → reduce(state, msg, now) → { state, effects }`; components render `deriveScreen(state)` and the runner turns effects into messages.

- `src/model/`: pure. `reduce.ts` is the only writer of `State`; `screen.ts` derives everything shown.
- `src/effects/`: one handler per `Effect` kind. Ports (`ports.ts`) are the only way out; `host-port.ts` is the SDK adapter.
- `src/ui/`: components read `useApp().screen()` and dispatch intents. They decide nothing.
- `src/app/`: wiring. `src/lib/`: pure helpers. `src/services/`: IO behind ports.
- Change what Enter, Ctrl+Enter, Esc and Ctrl+C do in `src/model/interactions.ts`, not in a handler. Keys are named in `CHAT_KEYBINDS` and `FIELD_KEYBINDS` (`src/lib/constants.ts`).
- Local input changes in `reduce` before any host work.
- Native resources (`SyntaxStyle`, `TextBuffer`) take `renderer.nativeScene` as owner; read layout with `getComputedLayout()`.

`test/boundaries.test.ts` enforces:

- `model/` imports no Solid, OpenTUI, `node:*`, effects, services, ui or app, and the SDK only as types.
- `ui/` imports no effects or services, and the SDK only as types.
- Only `effects/host-port.ts` imports SDK values.
- No `setFrameCallback` and no raw `keyInput` listeners; keys go through `@opentui/keymap` layers.
- Colors only in `src/lib/theme.ts`.

## Hosts

- Each command starts its own host on a worker thread (`src/local-host.ts`, `src/hosting.ts`) over the shared `~/.nyte/nyte.db`, and talks to it only through `sdk.connect`.
- `nyte host` serves one host and publishes `~/.nyte/host.json`. `--host-url` with `NYTE_HOST_TOKEN` attaches to it instead (`HostSource`). An attached TUI never starts a local host.

## Theme tokens

- `model/` and `lib/` name tokens through unions of `CliTheme` keys; components draw `theme()[tone]`. Widen the union for a new token.
- `foreground` is primary text, `dim` secondary text, `muted` separators and shading only, never text. `error`, `warning`, `ok` and `running` are status.
- A new token goes in `CliTheme`, both defaults and `monochrome()`. If it colors text, add it to `TEXT` in `test/lib/theme.test.ts`, which checks contrast.

## Stories

- Add a story under `dev/stories/` with `defineStory` and register it in `dev/stories/index.ts`. Run it with `NYTE_STORY=<id> pnpm dev:tui`.
- Render the real component over a real `State` from the test fixtures, and change state only through `reduce`.
- Give each state dimension a `Control` on a key in `STORY_KEYBINDS`. `test/stories.test.tsx` checks every story at two widths.
- Effects run over `fakePorts(fakeHost())`. Add an effect whose handler bypasses `Ports` to the skip list.

## Tests

- `bun test` runs in process: model tests over `test/fixture/view.ts`, effect tests over `fakeHost`/`fakePorts`, UI tests with `testRender`.
- App tests use `startTui()` (`test/harness/tui.ts`). Drive keys by command name with `press`, never by escape sequence.
- `qa/binary.smoke.ts` covers only what the compiled binary shows: startup, trust, exit codes, the resume text and `nyte host`.

## Verification

- `pnpm --dir packages/tui test`, `pnpm --dir packages/tui typecheck`.
- Compiled binary: `pnpm --dir packages/tui test:binary` (builds `dist/nyte`; `NYTE_BINARY` tests another build).
