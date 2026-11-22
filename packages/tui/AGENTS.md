# TUI

- Terminal rendering and keys live here. Session behaviour belongs in core.
- The TUI is a Solid app on `@opentui/solid`.
- `runTui` owns process-long resources. `mountApp` mounts the app, and its `close()` leaves the host open.
- Print mode and the CLI entry, flags and runner sit outside the app.
- `pnpm dev:tui [directory]` runs from source with hot reload on `~/.nyte/nyte-dev.db`. `NYTE_RELOAD=off` disables the reload, and `NYTE_DB` overrides the store.
- Only `pnpm install:tui` replaces `~/.nyte/bin/nyte`. Nothing from the dev tooling reaches the binary.

## Architecture

One loop: `dispatch(msg) → reduce(state, msg, now) → { state, effects }`. Components render `deriveScreen(state)`, and the runner turns effects into messages.

- **Model.** Pure. `reduce` is the only writer of `State`. `deriveScreen` derives everything shown.
- **Effects.** One handler per `Effect` kind. `Ports` are the only way out. The host port is the only SDK adapter.
- **UI.** Components read `useApp().screen()` and dispatch intents. They decide nothing.
- **App** is wiring. **Lib** is pure helpers. **Services** is IO behind ports.

Rules:

- Change what Enter, Ctrl+Enter, Esc and Ctrl+C do in `interactionsFor`, never in a handler.
- Keys are named in `CHAT_KEYBINDS` and `FIELD_KEYBINDS`.
- Local input changes in `reduce` before any host work.
- Native resources (`SyntaxStyle`, `TextBuffer`) take `renderer.nativeScene` as owner.
- Read layout with `getComputedLayout()`.

The boundaries test enforces these:

- The model imports no Solid, OpenTUI, `node:*`, effects, services, UI or app. It imports the SDK only as types.
- The UI imports no effects or services. It imports the SDK only as types.
- Only the host port imports SDK values.
- No `setFrameCallback` and no raw `keyInput` listeners. Keys go through `@opentui/keymap` layers.
- Colours appear only in the theme (`CliTheme`).

## Hosts

Every command is a client of the machine's one host.

- `connectHost` attaches to the host that `~/.nyte/host.json` names (`findRunningHost`).
- With no host, it starts `nyte host --log --supervised` detached in the home folder. It waits up to 20 s for that file to name a live host, then fails naming `hostLogPath()`.
- That host keeps running after the command exits. Quitting the TUI leaves its jobs and runs going.
- Requests go through `sdk.connect`. Chats, the session list, streamed text and health go through one `openHost` connection.
- The SDK's supervisor is the only reconnect. The TUI keeps none of its own.
- Resolve a `HostSource` once. `attachedSource` deletes `NYTE_HOST_TOKEN` on first use.
- `--host-url` with `NYTE_HOST_TOKEN` attaches to a named host (`HostSource`). It never starts one.
- The TUI's working directory picks a new chat's workspace (`addFolder`), whichever folder the host opened on.
- A running host doesn't see API keys exported only in the current shell.

One home, one host:

- `serveHost` takes the host lock (`hostLockPath`) before it opens the store.
- A command that finds no host starts one only while nobody holds the lock (`hostLockHeld`). While the lock is held, a host is already starting. The command waits for its endpoint and attaches.
- Two commands that both find the lock free each start a host. The one that loses the lock exits 1 as a `conflict`.
- `connectHost` never reads that exit code while the lock is held.
- The desktop's launch agent stands by on the same lock instead of exiting. It serves once the holder stops.

Retiring an old host:

- A `--supervised` host exits only when a live process asks it to and nothing runs on it (`retireOnRequest`).
- A local command that attaches to a host with an older `HostView.version` (`supersedes`) files a request (`requestRetire`). Once the host has taken it and exited, the command starts its own build on the address the old one saved.
- A host that exits without taking a request stopped for another reason, such as Stop Host. No command starts it again.
- A host acts only on requests of its own supervisor kind. A `nyte` request never retires the desktop app's launchd host.

`nyte host`:

- It serves one host through `serveHost`, shared with the desktop app's host, and publishes `~/.nyte/host.json`.
- On a signal it has 12 s to stop its worker and release its leases (`extendShutdown`). Every other command has 1.5 s. A second signal exits at once.
- It runs on Bun, which can't run `@lydell/node-pty`. A pty `jobs.start` answers `unavailable`. Terminals open on the desktop app's host, which runs on Electron's Node.
- It keeps its port and token across restarts, clean or not, so attached clients resume. If another process holds the port, it takes a new one and says so on stderr.

`pnpm dev:tui` takes the same path:

- It attaches to whatever host runs, the installed one included. `NYTE_DB` doesn't apply there.
- With no host, the one it starts runs this checkout on `NYTE_DB`. Every other client attaches to it until it stops.

## CLI

Load the cli-design skill for how output, options, help, errors and exit codes should read.

- `resolveMode` decides interactivity, browser opening and colour. A one-shot command takes its `Mode`. It never reads `isTTY`, `CI`, `NO_COLOR`, `FORCE_COLOR` or `TERM` to decide.
- Write through `Output`. The result and JSON go to stdout, and everything else goes to stderr.
- Only prompts (`confirm`, `cliLoginDriver`) write to stderr past `Output`.
- Never use `console`. Bun paints `console.error` red on a TTY.
- Fail with `CliError(reason)`. `REASONS` sets the class, exit code and JSON status.
- Next steps carry argv, and `shellCommand` renders them.
- `COMMANDS` is the one command list. `route`, help and `parseCommandArgs` derive from it, and `HANDLERS` is typed against it.
- Switching the update channel never installs an older release. Only a named version rolls back.
- An agent's Bash stdin never reaches EOF. Print mode reads stdin beside a prompt argument only from a FIFO or a file.

## Theme tokens

- The model and lib name tokens through unions of `CliTheme` keys. Components draw `theme()[tone]`. Widen the union for a new token.
- `foreground` is primary text. `dim` is secondary text. `muted` is for separators and shading, never text.
- `error`, `warning`, `ok` and `running` are status.
- A new token goes in `CliTheme`, both defaults and `monochrome()`.
- If it colours text, add it to `TEXT` in the theme test, which checks contrast.

## Stories

- Add a story with `defineStory` and register it in the story index. Run it with `NYTE_STORY=<id> pnpm dev:tui`.
- Render the real component over a real `State` from the test fixtures. Change state only through `reduce`.
- Give each state dimension a `Control` on a key in `STORY_KEYBINDS`. The stories test checks every story at two widths.
- Effects run over `fakePorts(fakeHost())`. An effect whose handler bypasses `Ports` goes on the skip list.

## Tests

- `bun test` runs in process. Model tests run over the view fixtures, effect tests over `fakeHost` and `fakePorts`, and UI tests with `testRender`.
- App tests use `startTui()`. Drive keys by command name with `press`, never by escape sequence.
- The binary smoke test covers only what the compiled binary shows: startup, trust, exit codes, the resume text and `nyte host`.
- A test home's teardown stops every process still running with that `HOME` (`stopHomeProcesses`). The host a TUI started there doesn't outlive it.

## Verification

- `pnpm --dir packages/tui test` and `pnpm --dir packages/tui typecheck`.
- `pnpm --dir packages/tui test:binary` builds the binary and tests it. `NYTE_BINARY` tests another build.
