# TUI

- Terminal rendering and keys live here; session behaviour belongs in core.
- A Solid app on `@opentui/solid`. `runTui` owns process-long resources; `mountApp` mounts the app, and its `close()` leaves the host open. Print mode and the CLI entry, flags and runner sit outside it.
- `pnpm dev:tui [directory]` runs from source with hot reload (`NYTE_RELOAD=off` disables it) on `~/.nyte/nyte-dev.db` (`NYTE_DB` overrides). Only `pnpm install:tui` replaces `~/.nyte/bin/nyte`. Nothing from the dev tooling reaches the binary.

## Architecture

One loop: `dispatch(msg) → reduce(state, msg, now) → { state, effects }`; components render `deriveScreen(state)` and the runner turns effects into messages.

- Model: pure. `reduce` is the only writer of `State`; `deriveScreen` derives everything shown.
- Effects: one handler per `Effect` kind. `Ports` are the only way out; the host port is the only SDK adapter.
- UI: components read `useApp().screen()` and dispatch intents. They decide nothing.
- App: wiring. Lib: pure helpers. Services: IO behind ports.
- Change what Enter, Ctrl+Enter, Esc and Ctrl+C do in `interactionsFor`, not in a handler. Keys are named in `CHAT_KEYBINDS` and `FIELD_KEYBINDS`.
- Local input changes in `reduce` before any host work.
- Native resources (`SyntaxStyle`, `TextBuffer`) take `renderer.nativeScene` as owner; read layout with `getComputedLayout()`.

The boundaries test enforces:

- The model imports no Solid, OpenTUI, `node:*`, effects, services, UI or app, and the SDK only as types.
- The UI imports no effects or services, and the SDK only as types.
- Only the host port imports SDK values.
- No `setFrameCallback` and no raw `keyInput` listeners; keys go through `@opentui/keymap` layers.
- Colors only in the theme (`CliTheme`).

## Hosts

- Every command is a client of the machine's one host. `connectHost` attaches to the host `~/.nyte/host.json` names (`findRunningHost`); with none, it starts `nyte host --log` detached in the home folder and waits for that file to name a live host, up to 20 s, then fails naming `hostLogPath()`. That host keeps running after the command exits, so quitting the TUI leaves its jobs and its runs going. Requests go through `sdk.connect`, and chats, the session list, streamed text and health through one `openHost` connection. The SDK's supervisor is the only reconnect; the TUI keeps none of its own.
- One home has one served host: `serveHost` takes the host lock (`hostLockPath`) before it opens the store. Two commands that find no host each start one; the one that loses the lock exits 1 as a `conflict`. `connectHost` never reads the exit code: while the lock is held it keeps waiting for the winner to publish its endpoint, and both attach to it. The desktop's launch agent stands by on the same lock instead of exiting, and serves once the holder stops.
- The TUI's working directory still picks a new chat's workspace (`addFolder`), whichever folder the host opened on. A running host doesn't see API keys exported only in the current shell.
- `pnpm dev:tui` takes the same path: it attaches to whatever host runs, the installed one included, where `NYTE_DB` doesn't apply; with none, the host it starts runs this checkout on `NYTE_DB`, and every other client attaches to it until it stops.
- `nyte host` serves one host (`serveHost`, shared with the desktop app's host) and publishes `~/.nyte/host.json`. It runs on Bun, which can't run `@lydell/node-pty`, so a pty `jobs.start` answers `unavailable`; terminals open on the desktop app's host, which runs on Electron's Node. It keeps its port and token across restarts, clean or not, so attached clients resume; a port another process holds gets a new one and a line on stderr. `--host-url` with `NYTE_HOST_TOKEN` attaches to a named host instead (`HostSource`), and never starts one.

## Theme tokens

- The model and lib name tokens through unions of `CliTheme` keys; components draw `theme()[tone]`. Widen the union for a new token.
- `foreground` is primary text, `dim` secondary text, `muted` separators and shading only, never text. `error`, `warning`, `ok` and `running` are status.
- A new token goes in `CliTheme`, both defaults and `monochrome()`. If it colors text, add it to `TEXT` in the theme test, which checks contrast.

## Stories

- Add a story with `defineStory` and register it in the story index. Run it with `NYTE_STORY=<id> pnpm dev:tui`.
- Render the real component over a real `State` from the test fixtures, and change state only through `reduce`.
- Give each state dimension a `Control` on a key in `STORY_KEYBINDS`. The stories test checks every story at two widths.
- Effects run over `fakePorts(fakeHost())`. Add an effect whose handler bypasses `Ports` to the skip list.

## Tests

- `bun test` runs in process: model tests over the view fixtures, effect tests over `fakeHost`/`fakePorts`, UI tests with `testRender`.
- App tests use `startTui()`. Drive keys by command name with `press`, never by escape sequence.
- The binary smoke test covers only what the compiled binary shows: startup, trust, exit codes, the resume text and `nyte host`.
- A test home's teardown stops every process still running with that `HOME` (`stopHomeProcesses`), so the host a TUI started there doesn't outlive it.

## Verification

- `pnpm --dir packages/tui test`, `pnpm --dir packages/tui typecheck`.
- Compiled binary: `pnpm --dir packages/tui test:binary` (builds the binary; `NYTE_BINARY` tests another build).
