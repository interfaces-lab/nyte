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
an active secret prompt does not save a credential.

`nyte logout <provider>` works without a terminal and removes only that stored credential.
Its receipt reports credentials still available through environment variables or other tools.
`nyte login --help`, `nyte logout --help`, `nyte update --help`, and `nyte status --help`
show command-specific usage without starting the operation. Help must be used on its own.
Unknown, duplicate, and incompatible options fail before the operation starts.

`nyte update`, `nyte update <version>`, and `nyte update --check` select latest install,
versioned install, and check-only respectively. Update progress uses stderr; results use stdout.
`--json` is supported for print and status, not login, logout, or update.

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

## Tasks

`/tasks` is the single work browser. It lists unfinished subagents and background commands.
Foreground bash stays in the conversation, including after it finishes. Commands inside a
subagent stay inside that subagent's transcript, not in the parent Tasks list.

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

Child tasks inherit workspace trust. Background agents are not offered tools marked
`availability: "foreground"`, regardless of their name. That capability means the tool needs a
participant or another foreground-only host service; it is separate from whether a wait carries a
selection.

## Subagent models

The parent chooses an exact `provider/model` for each task call. You can instruct it which model
to use. An unavailable selection fails before child creation; Nyte never substitutes another
model or provider.

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
