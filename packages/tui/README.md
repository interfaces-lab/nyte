# TUI

Nyte's terminal host uses core's SDK for sessions and jobs. Terminal rendering and keyboard
interaction live here; job execution, cancellation, and recovery live in core.

## Minimal mode (POC)

```sh
NYTE_RELOAD=off pnpm dev:tui --minimal
# Or build without replacing your installed nyte:
pnpm --dir packages/tui build
./packages/tui/dist/nyte --minimal
```

`--minimal` also works with `--resume` and `--session`. It requires an interactive
terminal and cannot be combined with print, JSON or quiet mode.

The prompt follows terminal output instead of taking over the screen. Tree, model,
question, trust and task dialogs use the same bounded inline area. Esc returns to
the saved draft. Ctrl+O toggles a bounded transcript pane for tool output.

The implementation lives in `src/mini/`:

- `screen.tsx`: the live footer, shared composer and shared dialogs.
- `transcript.ts`: orders settled entries and the unfinished suffix.
- `scrollback.ts`: appends settled entries to native scrollback without rewriting it.

This shares `mountApp`, the reducer, effects, plugins and keymap with the existing
TUI. A separate SDK-driven frontend would isolate the layout but duplicate the
interactive controller, including question handling and tree navigation.

POC limits: streaming stays in the live footer until each message settles. Successful
tools show compact headings; failures retain their output. Committed output does not
repaint on theme changes. Resume and development remounts replay the loaded history
tail, not the entire session. Images and custom plugin parts use a text fallback.

## CLI session targets

`nyte -p --session <session-id> <prompt>` sends a prompt to that exact session.
`nyte -p --resume <prompt>` sends the prompt to the latest used top-level session.
The positional text after `-p --resume` is always prompt text, including text that
looks like a session ID. `--session` and `--resume` are mutually exclusive.

To inspect a session without submitting another prompt, run `nyte --session <session-id>`
in a terminal from the original workspace. Print mode's recovery command uses this form
and quotes shell-sensitive IDs for POSIX shells. It does not repeat the original prompt.
For IDs beginning with `-`, use `--session=<session-id>`.

When there is no positional prompt, print mode reads stdin. Piped stdin selects print
mode even when stdout is a terminal. An explicit positional prompt takes precedence
over stdin. `--effort` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and
`max`; an invalid explicit value is an error. The selected model may clamp a valid level.
In print mode `--model` also becomes the host's default model; `--effort` applies to that run only.

`--trust` and `--no-trust` save whether the folder's project files (skills, plugins, MCP
servers) load, the same way `/trust` does: for the resumed session's folder, or the current
folder for a new chat. Without either, the terminal asks before a folder with project files
and no saved decision runs its first message. Print mode never asks: there an undecided folder
loads its project files only when the Project trust setting is `always`.

## Print output and exits

Human print mode writes answer text to stdout and tool names and diagnostics to stderr.
`--quiet` suppresses tool names and JSON tool events, while retaining answers and terminal results.
Live text is reconciled with durable assistant commits;
providers that only return a final message are supported. Before reporting completion,
print drains committed output through the SDK replay boundary. Watch or replay failures
produce `delivery_failed`, even if the stored run finished. Recovery never resends the prompt.
If a provider retries after emitting text or commits different text, print reports delivery
failure because stdout cannot retract the earlier text. Inspect the saved session.

`--json` writes JSONL text records and `{ "type": "tool", "name": "…" }` tool records,
followed by one terminal `result` record after cleanup when stdout is writable.
Cleanup failures produce `cleanup_failed`; a diagnostic sink failure cannot skip remaining cleanup
or the JSON terminal record. Local cleanup causes are retained outside machine output.
The result has `kind` and `code`, a `session` when known, and `next.argv` and `next.command`
when a session can be opened. Failures include `message`; local signals include `signal`.
Parse, settings, and startup errors also produce a terminal JSON record.

| Terminal kind | Exit | Meaning |
| --- | --- | --- |
| `completed` | 0 | The run finished and output delivery drained |
| `failed` | 1 | Startup, configuration, run, delivery, or cleanup failed |
| `input-required` | 2 | Print stopped and settled a run waiting on a question part |
| `aborted` | 130 | The durable run was aborted |
| `cancelled` | 130, 143 or 129 | This CLI was interrupted by SIGINT, SIGTERM or SIGHUP, respectively |

Print waits through background tools. For a run waiting on a question, it stops the run and awaits
its settlement before reporting `input_required`. It never answers.
The supplied recovery command opens interactive inspection in the original workspace without
submitting a message; the aborted call is no longer pending.
Local signal cancellation requests a run abort separately from
stopping the SDK waiter; a cancelled waiter alone does not prove the run was aborted.

`nyte status --json` emits a `status` record listing each provider with a credential and its
state (`configured`, `verified` or `failed`), then a terminal result. It does not include credential values. `nyte status --help`
shows its accepted options.

## CLI authentication and updates

Login runs through the host, which keeps the credential encrypted in its store. It requires
terminal stdin and stderr before provider login starts, even when the provider and method are
explicit. Redirecting stdout is supported. Prompts, masked secret
input, authentication instructions, and progress use stderr. Login and logout receipts
use stdout. SIGINT and Ctrl+C cancel login with exit 130; SIGTERM exits 143. Cancelling
an active secret prompt does not save a credential. GitHub Copilot discovers the account's
available model IDs before saving its OAuth credential. If discovery fails, login fails and
saves nothing. Catalog reads restore persisted models, then refresh the hosted feed when the
network is available. A signed-out interactive launch fetches the feed so the shell can open and
offer `/login`; if no cached catalog exists while offline, Nyte reports that no models are available.

`nyte logout <provider>` works without a terminal and removes only that stored credential.
`nyte login --help`, `nyte logout --help`, `nyte update --help`, and `nyte status --help`
show command-specific usage without starting the operation. Help must be used on its own.
Unknown, duplicate, and incompatible options fail before the operation starts.

`nyte update`, `nyte update <version>`, and `nyte update --check` select latest install,
versioned install, and check-only respectively. `nyte update --models` refreshes the hosted model
catalog without updating Nyte. These choices are mutually exclusive. Update progress uses stderr;
results use stdout.
`--json` is supported for print and status, not login, logout, or update.

When an interactive login displays a browser URL or device code, Enter or `o` opens that URL.
`c` copies the device code, or the URL when there is no device code.
Enter-to-open is Nyte's addition to the upstream login shortcuts.

## Text selection and copying

Selection follows [OpenCode v2](https://github.com/anomalyco/opencode/blob/0643a5638e0cd02234e73f176771527d7600faf7/packages/tui/src/util/selection.ts).
Copy-on-select defaults to on for macOS and Linux, and off for Windows. Change it with
`/copy-on-select on` or `/copy-on-select off`; the `copyOnSelect` setting supports global
and workspace overrides.

With copy-on-select on, releasing a mouse selection copies it. With it off, Ctrl+C or
right-click copies highlighted text. Copy keeps the highlight and double/triple-click selection
history. Successful writes show `Copied to clipboard` and target both the host and terminal clipboard.

Selection keys run before app bindings. Escape clears a nonempty selection without cancelling
or closing anything. In copy-on-select mode, Ctrl+C clears a transcript highlight and reaches
the current app action, including cancellation. Editor selections still copy with Ctrl+C in
either mode. Other keys clear transcript selections but preserve editor selection handling.
There is no app-level Cmd+C binding, matching OpenCode; native Cmd+C belongs to the terminal.

## Local plugins and reload

The host loads core plugins from `~/.nyte/plugins/` and the workspace's `.nyte/plugins/`: a
`<name>.ts` or `<name>.js` file, or `<name>/index.<ext>`, exporting a `Plugin` from
`@nyte-ai/plugin/core`. The terminal mounts its own client plugins: run notifications and the
`@nyte-ai/plugin/client/transcript-tui` part renderers and the `@nyte-ai/plugin/client/questions-tui` question plugin.

`/reload` re-reads the workspace's project resources and this terminal's settings.

## Working directory

`/cd <path>` changes the current chat's working directory without losing its history.
Relative paths start from the chat's current directory. Absolute paths, `~`, `~/…`, and
paths containing spaces work. Paths are literal, not shell expressions.

Selecting `/cd` fills the composer. Directory suggestions appear as you type; Tab completes a
path so you can browse deeper. The destination is registered as a workspace on this host and the
chat moves there.

Finish active runs, jobs, and queued messages before switching. Tools, skills, project plugins,
file mentions, and the status bar follow the new directory. Other chats keep their directories.
New chats start in the current directory.

History lives in `~/.nyte/nyte.db`, shared by every launch on this machine. The chat
remembers its working directory.

## Transcript scrolling

Mouse-wheel events move three rows by default. `/scroll-acceleration on` enables timing-based
acceleration and `/scroll-acceleration off` restores the fixed step. The choice is saved in
`~/.nyte/settings.json` as `scrollAcceleration`; a workspace can override it in
`.nyte/settings.json`.

Page Up and Page Down move half a viewport. Ctrl+Up and Ctrl+Down visit conversation turns, even
when the selected turn is near the end of a short transcript. While reading older output, Nyte
keeps the visible text at the same screen row as new output arrives. Press Ctrl+End or use the
`ctrl+end latest ↓` row to follow live output again. Plain Up and Down still browse composer
history at the start and end of a draft.

Notices, completion lists, and pickers use rows below the composer. Text panels such as `/usage`
draw over the transcript; the tree and task inspection take the whole screen.

## Pending messages

Enter steers the live run; Ctrl+Enter queues a follow-up for after it (`followUp` in settings
swaps the two). Both wait in rows between the transcript and the composer, labelled by where core
scheduled them rather than how they were sent: `steer · next response`, `queued`, `next`,
`after this run`, `next turn · new model`, `attached`, `sending…`, or `waiting for a host`.
Reports from subagents and background jobs wait above them and are never yours to edit.

Ctrl+Q opens the queue to send, edit, remove, or reorder pending messages. Clicking a row opens the
queue on that message; dragging one onto another reorders it. Removing a message that already
landed reports `Already sent`.

## Thinking level

Shift+Tab, `/effort` and the model picker set the level for the session's next run. The host
remembers the last level you chose for each model, and a new session starts at it. `--effort`
overrides it for that launch; a resumed session keeps its own level.

## Tasks

`/tasks` is the single work browser. It lists unfinished subagents and background commands.
Foreground bash stays in the conversation, including after it finishes. Commands inside a
subagent stay inside that subagent's transcript, not in the parent Tasks list.

The agent's `task` tool waits by default. If it starts independent work in the background,
`wait_task` can later join that same task by job ID and continue the parent conversation.
The agent should join reports it needs before finishing, rather than poll or start another task.
Sending a message while the agent waits on a task ends that wait, and moves a foreground
subagent to the background. The task keeps running either way. A message you queue instead
of sending waits for the agent to finish, and leaves the wait alone.
A result arriving after the parent has finished remains queued for your next message.

The composer shows `2 running in background · ↓ view` for unfinished background work only.
The row disappears at zero. Foreground subagents remain accessible through `/tasks` without
adding to that count. Finished in the same browser retains eligible tasks and their output.

| Input | Action |
| --- | --- |
| `Ctrl+Z` in the composer | Background running foreground work on the current head, including bash not listed in Tasks. |
| `/tasks` | Open unfinished work. Select Finished to inspect completed work. |
| `Enter` in Tasks | Inspect command output or the full child conversation. |
| `Ctrl+Z` in Tasks | Background the selected running foreground task. |
| `Ctrl+X` in Tasks or inspection | Cancel the selected task, not its parent run. |
| `Esc` in inspection | Return to the same Tasks section. |
| `Esc` in Tasks | Clear the filter, then go back or close. |
| `Esc` in the composer | Abort the active parent run and stop its subagents, including backgrounded children. Independent background commands continue. |

Arrow keys and Page Up/Page Down scroll inspection. Ctrl+Up/Ctrl+Down switch tasks in that
section; Ctrl+O follows output. Defaults live in `CHAT_KEYBINDS`. Closing a view does not
cancel work or change queued messages. Child inspection keeps the full transcript, including
tool output. Plugin consent and questions still follow child sessions.

The desktop uses the same Tasks/Finished policy. Its Tasks control stays available when the
background count disappears. Inspect conversation opens the child's full chat.

Task metadata and output are durable, but processes are not. Closing the owning host interrupts
live work. Recovery marks abandoned work `interrupted` and never reruns it. Core records
background completion separately from user messages; completion never enters the user queue.
A result may join an active run, but never starts a new run on its own. When the chat is idle,
it waits for your next message and remains available in Tasks. Compaction may continue an active
run, but cannot restart a stopped one.

Background agents are not offered tools marked
`availability: "foreground"`, regardless of their name. That capability means the tool needs a
participant or another foreground-only host service; it is separate from whether a wait carries a
selection.

## Subagent models

A delegated task defaults to `openai-codex/gpt-5.6-sol` with `high` thinking. Ask for another
model or thinking level when needed; the parent passes that explicit choice for the task call.
There is no global subagent setting. An unavailable explicit choice or default fails before child
creation, and Nyte never substitutes another model or provider.

## Verification

From the repository root:

```sh
pnpm --dir packages/tui test
pnpm --dir packages/tui test:binary
pnpm --dir packages/tui typecheck
```

`test` runs every test in process under `bun test`: the whole TUI on OpenTUI's test renderer over
an in-process host with a scripted provider. `test:binary` builds `dist/nyte` and runs a small smoke
of the compiled binary through pipes and a PTY. See `qa/README.md`.

## Local shell

Type `!command` at the very start of the composer to run a local command in the
current workspace. `!!command` runs privately and leaves its output out of model
context. A bang after whitespace or elsewhere in a message is ordinary text.
Shell input does not open slash or mention completion menus.

The hint row changes to `enter run locally` or `enter run privately`. One local
command runs at a time. Esc stops its process tree; quitting stops it too. While it
runs you can write the next prompt, but sending waits until the command finishes
or is cancelled, without clearing the draft. Send it again after the command ends.

Successful and nonzero-exit `!` results become a removable composer attachment for
the next prompt. No model request starts just because a shell command completes.
Commands run by `!` are owned by this TUI, not core jobs: they are not backgrounded
by Ctrl+Z or listed in `/tasks`. Those controls still apply to agent tools and
subagents. Local cards and unsent results last only for this TUI instance; output
already sent in a prompt remains in the saved conversation.

## Usage

`/usage` opens a scrollable panel over the transcript. Escape closes the panel and
restores composer focus.

Each provider that reported account windows on its last response gets a section: each window
labels the percentage used and remaining, with the reset time when known, over a bar that turns
the warning colour at 85% and the error colour at 95%. Percentages always
come from the provider; no quota is inferred from local token history.

The panel also shows this chat's consumption: total tokens, input/output and cache breakdowns,
and estimated API cost from its completed runs. API cost estimates are not subscription charges.

## Filename search

The TUI's `@` mentions list the workspace's files through its files capability, ignored files
left out, and rank them fuzzily on every platform. No native filename library is embedded in the
CLI. A mention spelled as a path (`@./`, `@../`, `@~/`, an absolute path) is checked on disk and
offered first, so files outside the index or the workspace can be attached. The list is read when
the workspace opens or changes; files created later are reachable through such a path.
