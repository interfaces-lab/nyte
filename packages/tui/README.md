# TUI

Nyte's terminal host uses core's SDK for sessions and jobs. Terminal rendering and keyboard
interaction live here; job execution, cancellation, and recovery live in core.

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
Parse, trust, settings, and startup errors also produce a terminal JSON record.

| Terminal kind | Exit | Meaning |
| --- | --- | --- |
| `completed` | 0 | The run finished and output delivery drained |
| `failed` | 1 | Startup, configuration, run, delivery, or cleanup failed |
| `input-required` | 2 | Print aborted and durably settled a run parked with a participant `Selection`, such as a question or web-search consent |
| `aborted` | 130 | The durable run was aborted |
| `cancelled` | 130 or 143 | This CLI was interrupted by SIGINT or SIGTERM, respectively |

Print waits through background tools. For a call parked with a participant `Selection`, it requests
abort and awaits durable settlement before reporting `input_required`. It never approves or replies.
The supplied recovery command opens interactive inspection in the original workspace without
submitting a message; the aborted call is no longer pending.
Local signal cancellation requests a run abort separately from
stopping the SDK waiter; a cancelled waiter alone does not prove the run was aborted.

`nyte status --json` emits a `status` record containing stored credential provider and method
metadata, then a terminal result. It does not include credential values. `nyte status --help`
shows its accepted options.

## CLI authentication and updates

Login requires terminal stdin and stderr before provider login starts, even when the
provider and method are explicit. Redirecting stdout is supported. Prompts, masked secret
input, authentication instructions, and progress use stderr. Login and logout receipts
use stdout. SIGINT and Ctrl+C cancel login with exit 130; SIGTERM exits 143. Cancelling
an active secret prompt does not save a credential. GitHub Copilot discovers the account's
available model IDs before saving its OAuth credential. If discovery fails, login fails and
saves nothing. Later catalog reads combine generated model definitions with that account filter
without network access or token refresh. A signed-out interactive launch still uses baked model
definitions so the shell can open and offer `/login`; sending a request still requires auth.

`nyte logout <provider>` works without a terminal and removes only that stored credential.
Its receipt reports credentials still available through environment variables or other tools.
`nyte login --help`, `nyte logout --help`, `nyte update --help`, and `nyte status --help`
show command-specific usage without starting the operation. Help must be used on its own.
Unknown, duplicate, and incompatible options fail before the operation starts.

`nyte update`, `nyte update <version>`, and `nyte update --check` select latest install,
versioned install, and check-only respectively. Update progress uses stderr; results use stdout.
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

## Working directory

`/cd <path>` changes the current chat's working directory without losing its history.
Relative paths start from the chat's current directory. Absolute paths, `~`, `~/…`, and
paths containing spaces work. Paths are literal, not shell expressions.

Selecting `/cd` fills the composer. Directory suggestions appear as you type; Tab completes a
path so you can browse deeper. Untrusted destinations require approval before project plugins
or tools load. Cancel keeps the current directory.

Finish active runs, jobs, and queued messages before switching. Tools, skills, project plugins,
file mentions, and the status bar follow the new directory. Other chats keep their directories.
New chats start in the current directory.

History stays in the original workspace's database. To resume after quitting, launch Nyte from
that original workspace. The chat remembers its new working directory and checks trust again.

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

Notices, completion lists, and pickers use rows below the transcript. They do not cover transcript
or composer cells.

## Pending messages

Enter steers the live run; Ctrl+Enter queues a follow-up for after it. The two wait in different
places.

A steer message is drawn once, at the end of the conversation, in the shape of the turn it becomes:
the same user block, with a lane row (`… sending`, then `↑ steer`) where the run's status row will
go. The store's receipt and the admission each change only that row; the message keeps its screen
row and its block, and the next draft stays in the composer. An admitted request whose run has not
started yet keeps that row blank rather than dropping it, so nothing moves when the run arrives.
A message the store has accepted stays drawn until the watch shows it, matched by its change, never
by its text; a receipt that arrives after the watch already landed or cancelled the change draws
nothing. When a fresh snapshot cannot place an accepted message, the session is re-read in full and
the row stays until that read is on screen: it then shows the message pending or in the record, or
the row goes because the message was cancelled.

Follow-ups take compact rows between the transcript and the composer: one row each with the
message, its lane, and on the last row the key that opens the queue. The rows never take more than
about a third of the terminal; the rest is counted as `+N more`.

Ctrl+Q opens the queue to send, edit, remove, or reorder pending messages. Clicking a row or a
steer block opens the queue on that message; dragging one onto another reorders within a lane.

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

Child tasks inherit workspace trust. Background agents are not offered tools marked
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
pnpm --dir packages/tui run test
pnpm --dir packages/tui run test --filter tasks
pnpm --dir packages/tui run test:show --filter tasks
pnpm --dir packages/tui typecheck
```

QA builds and runs the actual CLI executable in a Bun PTY. OpenTUI's embedded terminal decodes
its output and encodes input; Nyte is not reconstructed in the test process. Scenarios use isolated
workspaces and loopback providers, and read keys from `src/constants.ts`.

Each run prints its evidence directory, binary identity, scenario outcomes, and per-action latency
measurements. Visible mode displays the same PTY session. Emulator measurements do not establish
physical screen latency, OS clipboard behavior, or image-protocol rendering. See `qa/README.md`
for coverage and execution details.

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

`/usage` opens a scrollable panel below the composer, capped at 16 rows and roughly
40% of terminal height. The conversation stays visible. One loading line remains
until the complete report is ready; sections do not load progressively. Escape
closes the panel, restores composer focus, and cancels outstanding reads.

Claude and Codex account sections show 5-hour, weekly, and provider-reported
model-specific windows, including Claude Fable. Each meter labels the percentage
used and remaining, with the reset time when known. Account reads use Nyte's
existing provider logins, independently of the selected model. Missing login or
request failure produces an explicit message. Percentages always come from the
provider; no quota is inferred from local token history. Account reads time out
after ten seconds so an unavailable endpoint cannot hold the report indefinitely.

The same panel shows Nyte workspace consumption and separate Claude Code and Codex
local history, grouped by model with token counts, input/output and cache breakdowns,
and estimated API cost. Tool histories are all-time across projects and do not
contribute to Nyte's workspace totals. API cost estimates are not subscription charges.
Missing prices and unreadable records are called out.

Local history uses the shared host reader with `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
These filesystem reads need no login or network call. Reopening `/usage` refreshes
the report and reuses unchanged file scans.

## Filename search

The TUI's `@` mentions use core's ripgrep file discovery and fuzzy ranking on every platform. Core owns executable resolution, ignore rules, and cancellation. No native filename library is embedded in the CLI.
