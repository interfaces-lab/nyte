# @nyte-ai/tui

This package builds `nyte`, Nyte's terminal client. It renders sessions and handles the keyboard.
Core runs the sessions and jobs, including cancellation and recovery, and the TUI reaches it
through the SDK.

## Quick start

Run the TUI from source with hot reload:

```sh
pnpm dev:tui
```

Or build the binary without replacing your installed `nyte`:

```sh
pnpm --dir packages/tui build
./packages/tui/dist/nyte
```

`pnpm install:tui` builds it and replaces the installed `nyte`. Run `nyte --help` for every
command and flag.

## Hosts

`nyte`, `nyte -p` and the other commands attach to this machine's one host, the one
`~/.nyte/host.json` names, whether the desktop app or `nyte host` started it. When none runs,
`nyte` starts `nyte host --log` in the background and attaches to it. That host keeps running after
`nyte` exits, so quitting the terminal leaves its runs and jobs going.

A new chat opens in the directory you started `nyte` in. A host that is already running doesn't see
API keys you exported only in the current shell. Pass `--host-url` to attach to another host
instead, with its token in `NYTE_HOST_TOKEN`.

History lives in `~/.nyte/nyte.db`, shared by every launch on this machine. When `pnpm dev:tui`
finds no running host, the host it starts uses `~/.nyte/nyte-dev.db` instead. `NYTE_DB` overrides
the path.

## Print mode

```sh
nyte -p "summarize this repository"
nyte -p --resume "and now the tests"
nyte -p --session <session-id> "try again"
```

`nyte -p --session <session-id> <prompt>` sends a prompt to that exact session.
`nyte -p --resume <prompt>` sends it to the latest used top-level session. Text after `-p --resume`
is always the prompt, even when it looks like a session ID. `--session` and `--resume` are mutually
exclusive.

To inspect a session without sending another prompt, run `nyte --session <session-id>` in a
terminal from the original workspace. Print mode's recovery command uses this form and quotes
shell-sensitive IDs for POSIX shells. It doesn't repeat the original prompt. For IDs that start
with `-`, use `--session=<session-id>`.

Without a positional prompt, print mode reads stdin. Piped stdin selects print mode even when stdout
is a terminal. A positional prompt takes precedence over stdin.

`--effort` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. Any other value is
an error. The selected model may clamp a valid level. In print mode `--model` also becomes the
host's default model, while `--effort` applies to that run only.

`--trust` and `--no-trust` save whether the folder's project files load, the same way `/trust`
does. Project files are skills, plugins and MCP servers. The decision applies to the resumed
session's folder, or to the current folder for a new chat. Without either flag, the terminal asks
before a folder with project files and no saved decision runs its first message. Print mode never
asks. There, an undecided folder loads its project files only when the Project trust setting is
`always`.

### Output

Human print mode writes answer text to stdout, and tool names and diagnostics to stderr. `--quiet`
hides tool names and JSON tool events but keeps answers and terminal results. Print works with
providers that return only a final message.

Print reports completion only after all committed output reaches stdout. If watching or replaying
the run fails, print reports `delivery_failed`, even when the stored run finished. It never resends
the prompt. If a provider retries after it emitted text, or commits different text, print also
reports a delivery failure, because stdout can't take back text it already wrote. Open the saved
session to see what happened.

`--json` writes JSONL text records and `{ "type": "tool", "name": "…" }` tool records, then one
terminal `result` record after cleanup, when stdout is writable. The result has `kind` and `code`,
a `session` when known, and `next.argv` and `next.command` when a session can be opened. Failures
add `message`, and local signals add `signal`. A cleanup failure produces `cleanup_failed`. Parse,
settings and startup errors also produce a terminal JSON record.

| Terminal kind | Exit | Meaning |
| --- | --- | --- |
| `completed` | 0 | The run finished and all output was delivered |
| `failed` | 1 | Startup, configuration, run, delivery or cleanup failed |
| `input-required` | 2 | Print stopped and settled a run that was waiting on a question |
| `aborted` | 130 | The durable run was aborted |
| `cancelled` | 130, 143 or 129 | SIGINT, SIGTERM or SIGHUP, respectively, interrupted this CLI |

Print waits through background tools. When a run waits on a question, print stops the run and waits
for it to settle before it reports `input_required`. It never answers a question. The recovery
command opens the session in the original workspace without sending a message.

A `cancelled` result means this CLI stopped waiting. The CLI also asks the host to abort the run,
but a `cancelled` result alone doesn't prove the run was aborted.

`nyte status --json` writes a `status` record that lists each provider with a credential and its
state, which is `unknown`, `configured`, `verified` or `failed`. A terminal result follows. The
record never includes credential values.

`nyte login`, `nyte logout` and `nyte update` don't accept `--json`.

## Login and updates

Login runs through the host, which keeps the credential encrypted in its store. `nyte login` needs a
terminal on stdin and stderr before provider login starts, even when you name the provider and
method. You can redirect stdout. Prompts, masked secret input, instructions and progress go to
stderr. Login and logout receipts go to stdout. SIGINT and Ctrl+C cancel login with exit 130, and
SIGTERM exits 143. Cancelling a secret prompt saves no credential.

When login shows a browser URL or device code, press Enter or `o` to open the URL. Press `c` to copy
the device code, or the URL when there is no code.

GitHub Copilot discovers the account's model IDs before it saves the OAuth credential. If discovery
fails, login fails and saves nothing.

The catalog loads saved models, then refreshes from the hosted feed when the network is available.
A signed-out interactive launch fetches the feed so the shell can open and offer `/login`. Offline
with no cached catalog, Nyte reports that no models are available.

`nyte logout <provider>` works without a terminal and removes only that stored credential.

| Command | What it does |
| --- | --- |
| `nyte update` | Installs the newest release on the running channel |
| `nyte update <version>` | Installs that version |
| `nyte update stable`, `nyte update nightly` | Switches to that channel's newest release |
| `nyte update --check` | Checks for an update without installing |
| `nyte update --models` | Refreshes the hosted model catalog only |

These choices are mutually exclusive. Update progress goes to stderr and results to stdout.

`nyte login --help`, `nyte logout --help`, `nyte update --help` and `nyte status --help` show usage
without starting the operation, even when you pass other arguments too. Unknown, duplicate and
incompatible options fail before the operation starts.

## Minimal mode

Minimal mode is experimental. The prompt follows terminal output instead of taking over the screen.

```sh
NYTE_RELOAD=off pnpm dev:tui --minimal
./packages/tui/dist/nyte --minimal
```

`--minimal` works with `--resume` and `--session`. It needs an interactive terminal and can't be
combined with print, JSON or quiet mode.

Tree, model, question, trust and task dialogs use the same bounded inline area. Esc returns to the
saved draft. Ctrl+O toggles a bounded transcript pane for tool output.

Limits:

- Streaming text stays in the live footer until each message settles.
- Successful tools show compact headings. Failures keep their output.
- Committed output doesn't repaint when the theme changes.
- Resume and development remounts replay the tail of the loaded history, not the whole session.
- Images and custom plugin parts show a text fallback.

## Pending messages

Enter steers the live run, and Ctrl+Enter queues a follow-up for after it. The `followUp` setting
swaps the two. Both wait in rows between the transcript and the composer, labelled by where core
scheduled them: `queued`, `next`, `after this run`, `attached`, `sending…`, `retrying · <reason>`,
`waiting for a host` or `waiting on plugins`. Reports from subagents and background jobs wait in
the transcript above them, and you can't edit those.

Ctrl+Q opens the queue to send, edit, remove or reorder pending messages. Click a row to open the
queue on that message, or drag one onto another to reorder it. Removing a message that already
landed reports `Already sent`.

## Thinking level

Shift+Tab, `/effort` and the model picker set the level for the session's next run. The host
remembers the last level you chose for each model, and a new session starts at it. `--effort`
overrides it for that launch. A resumed session keeps its own level.

## Tasks

`/tasks` lists unfinished subagents and background commands. Select Finished to inspect completed
work and its output. Foreground bash stays in the conversation, even after it finishes. Commands
inside a subagent stay in that subagent's transcript, not in the parent's Tasks list.

While subagents or background commands are unfinished, a row above the composer shows a count such
as `2 working in the background · ↓ view`. Press Down in an empty composer to open Tasks. The row
disappears at zero.

| Input | Action |
| --- | --- |
| `/tasks` | Open unfinished work |
| `Enter` in Tasks | Inspect command output or the full child conversation |
| `Ctrl+X` in Tasks or inspection | Cancel the selected task, not its parent run |
| `Ctrl+Up`, `Ctrl+Down` in inspection | Switch to the previous or next task in that section |
| `Esc` in inspection | Return to the same Tasks section |
| `Esc` in Tasks | Clear the filter, then go back or close |
| `Esc` in the composer | Abort the active parent run and stop its subagents, including backgrounded ones. Independent background commands continue. |

Arrow keys and Page Up and Page Down scroll inspection. Ctrl+End follows new output, and Ctrl+O
toggles following. Closing a view doesn't cancel work or change queued messages. Child inspection
shows the full transcript, including tool output. Plugin consent and questions still follow child
sessions.

Task metadata and output are durable, but processes are not. Quitting the terminal leaves them
running on the host. Stopping the host interrupts live work. Recovery marks abandoned work
`interrupted` and never reruns it.

Core records background completion apart from your messages, so a completion never enters your
queue. A result may join an active run, but never starts a new run on its own. When the chat is
idle, the result waits for your next message and stays available in Tasks. Compaction may continue
an active run, but can't restart a stopped one.

## Subagents

The agent's `task` tool runs a subagent and waits for its answer. `create`, `send` and `await` start
a subagent in the background and join it later. A subagent uses the default model and thinking
level unless the agent passes `model` or `thinking`, so ask for another model when you need one.

## Local shell

Type `!command` at the very start of the composer to run a local command in the current workspace.
`!!command` runs it privately and leaves its output out of model context. A `!` after whitespace or
anywhere else in a message is ordinary text. Shell input doesn't open slash or mention completion.

The hint row changes to `run locally` or `run privately`. One local command runs at a time. Esc
stops its process tree, and quitting stops it too. While it runs you can write the next prompt, but
sending waits until the command finishes or you cancel it. The draft stays, so send it again after
the command ends.

A `!` result, successful or nonzero, becomes a removable attachment on your next prompt. A finished
shell command never starts a model request on its own.

This TUI owns `!` commands, not core's jobs, so they don't appear in `/tasks`. Local cards and
unsent results last only for this TUI instance. Output you already sent in a prompt stays in the
saved conversation.

## Working directory

`/cd <path>` changes the current chat's working directory and keeps its history. Relative paths
start from the chat's current directory. Absolute paths, `~`, `~/…` and paths with spaces work.
Nyte reads paths literally, not as shell expressions.

Selecting `/cd` fills the composer. Directory suggestions appear as you type, and Tab completes a
path so you can browse deeper. The host registers the destination as a workspace and the chat moves
there.

Finish active runs, jobs and queued messages before you switch. Tools, skills, project plugins, file
mentions and the status bar follow the new directory. Other chats keep their directories, and new
chats start in the current one.

## Transcript scrolling

Each mouse-wheel event moves three rows. `/scroll-acceleration on` turns on timing-based
acceleration, and `/scroll-acceleration off` restores the fixed step. Nyte saves the choice in
`~/.nyte/settings.json` as `scrollAcceleration`. A workspace can override it in
`.nyte/settings.json`.

Page Up and Page Down move half a viewport. Ctrl+Up and Ctrl+Down visit conversation turns. While
you read older output, the visible text stays on the same screen row as new output arrives. Press
Ctrl+End or select the `latest ↓` row to follow live output again. Plain Up and Down browse composer
history at the start and end of a draft.

Notices, completion lists and pickers use rows below the composer. Text panels such as `/usage`
draw over the transcript. The tree and task inspection take the whole screen.

## Text selection and copying

Copy-on-select is on by default on macOS and Linux, and off on Windows. Change it with
`/copy-on-select on` or `/copy-on-select off`. The `copyOnSelect` setting takes global and workspace
values.

With copy-on-select on, releasing a mouse selection copies it. With it off, Ctrl+C or right-click
copies highlighted text. Copying keeps the highlight and the double- and triple-click selection.
A copy shows `Copied to clipboard` and writes the text to the system clipboard and the terminal's
clipboard, where each is available.

Selection keys run before app bindings. Esc clears a nonempty selection without cancelling or
closing anything. With copy-on-select on, Ctrl+C clears a transcript highlight and also runs the
current app action, including cancellation. Ctrl+C copies an editor selection in either mode. Other
keys clear transcript selections but leave editor selection alone. Nyte binds no Cmd+C, so Cmd+C
belongs to the terminal.

## File mentions

`@` lists the workspace's files, without ignored files, and ranks them fuzzily. A mention written as
a path, such as `@./`, `@../`, `@~/` or an absolute path, is checked on disk and offered first, so
you can attach files outside the index or the workspace. Nyte reads the list when the workspace
opens or changes. Reach files created later through such a path.

## Usage

`/usage` opens a scrollable panel over the transcript. Esc closes it and returns focus to the
composer.

Each provider that reported account windows on its last response gets a section. Each window shows
the percentage used and remaining, and the reset time when known, over a bar that turns the warning
colour at 85% and the error colour at 95%. The percentages always come from the provider. Nyte
infers no quota from local token history.

The panel also shows this chat's consumption from its completed runs: total tokens, input and output
and cache breakdowns, and estimated API cost. API cost estimates are not subscription charges.

## Plugins and reload

The host loads core plugins from `~/.nyte/plugins/` and the workspace's `.nyte/plugins/`. A plugin
is a `.ts`, `.mts`, `.js` or `.mjs` file, or a folder with an `index` file of one of those types,
that exports a `Plugin` from `@nyte-ai/plugin/core`.

The terminal mounts its own client plugins:

- `@nyte-ai/plugin/client/notifications` for run notifications
- `@nyte-ai/plugin/client/transcript-tui` for part renderers
- `@nyte-ai/plugin/client/questions-tui` for questions

`/reload` reads the workspace's project resources and this terminal's settings again.

## Development

```sh
pnpm --dir packages/tui test
pnpm --dir packages/tui test:binary
pnpm --dir packages/tui typecheck
```

`test` runs every test in process under `bun test`. It renders the whole TUI on OpenTUI's test
renderer over an in-process host with a scripted provider. `test:binary` builds `dist/nyte` and
runs a short smoke test of the compiled binary through pipes and a PTY. See
[qa/README.md](qa/README.md).

Read [AGENTS.md](AGENTS.md) before changing the TUI.
