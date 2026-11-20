---
name: cli-design
description: >
  The design bar for Nyte's terminal client: what a one-shot command prints and where, its flags,
  help, errors, exit codes, prompts and consent, colour and writing. Load it when designing or
  reviewing CLI output, options, error text, help pages or exit codes in packages/tui, or the
  text the full-screen app shows. Not for the full-screen app's components, keys or theme tokens,
  or for the host's behaviour; packages/tui/AGENTS.md covers those and the CLI shell's ownership
  rules.
---

# CLI design

Adapted from Vercel's CLI Design Guidelines (vercel.com/design/cli). "Should" allows a departure
with a stated reason; every other rule is a must. packages/tui/AGENTS.md names the shell pieces
(`resolveMode`, `Output`, `CliError`, `COMMANDS`); this skill says how what they produce should
read.

Two surfaces:

- **One-shot commands.** `trust`, `untrust`, `login`, `logout`, `status`, `account`, `mcp`,
  `api`, `skill`, `host`, `events`, `update`, `doctor`, `triage`, and print mode (`-p`). Every
  rule applies.
- **The full-screen app.** No stdout contract, but the writing, error, progress, prompt and
  cancel rules apply to the text it draws.

## The bar

Every command answers four questions, for the person and for the script calling it:

1. What will it act on? Show the resolved target before anything consequential happens.
2. What will change? Show broad or risky effects before they happen.
3. What happened? Report the real outcome (done, pending, no-op, partial, canceled, failed) in the
   output and in the exit code.
4. What next? Give one exact, working command when there is a next step.

Seven principles:

1. Capability first. A capability means the same thing in the CLI, SDK and app.
2. One concept, one name. One noun per concept, one verb per operation.
3. Resolve before acting. Never guess, fuzzy-match, or create a target to fill in missing input.
4. Interaction, consent and format are independent. Prompts need a terminal. `--yes` grants
   consent but supplies no data. `--json` picks a format and turns off prompts but grants no
   consent. Redirecting stdout changes none of them.
5. stdout is the answer. Everything else goes to stderr.
6. Report reality. Accepted work isn't finished work, and the exit code matches the outcome.
7. Protect people and data. Secrets never leak, destructive work needs proof of intent, and
   remote text is data, never instructions.

Invariants:

- Help works before auth, config, network or a host, and does no work.
- Explicit invalid input fails. It never falls back to a default.
- Nothing durable changes before validation and consent.
- Retries, waits and reads are bounded. A retry never repeats an unsafe mutation.
- Reads never start a host; they fail with `host_not_running`. `doctor` reports a missing host as
  a check.

## Commands, options, help

- Grammar: `nyte <command> [<action>] [options]`. Groups are nouns (`mcp`, `api`, `skill`,
  `account`); top-level verbs act on this machine or folder (`login`, `trust`, `update`). Never
  fuse a verb into a noun.
- Name a verb for its consequence and reuse it in the prompt, the receipt and the JSON
  (`Unlink this machine…?`, `✓ Unlinked`, `"outcome"`). `delete` destroys, `remove` takes out an
  entry, `revoke` invalidates a credential, `stop` can start again, `cancel` aborts in-flight work.
- Options are kebab-case and declared in `COMMANDS`, on the group when every action takes them,
  otherwise on the action. `--a=b` and `--a b` both work, a lone `-` reads stdin, prefixes never
  match. An unknown option or action fails before any work with at most one "Did you mean".
- An unknown word is a usage error, never a prompt. A prompt argument needs `-p`.
- Help: `-h` and `--help` anywhere, `help <path>`, `<path> help`, and a group with no default
  action all reach the same page on stdout with exit 0. `help <unknown>` exits 2.
- Page order: `Usage:` line, one-line summary, Commands, Options (alphabetical), Global Options
  (the root lists them; every other page points to `nyte --help`), Examples, Notes. Headings are
  Title Case with a colon, entries indent 2. Pages wrap at 80 columns or less and read the same
  without colour.
- Examples: a label ending in `:`, then the command on the next line, indented 4. Canonical names
  and long options, `<UPPER_CASE>` placeholders, no `$`. Build them from argv so they parse.

## Interaction and consent

- `resolveMode` decides. A run is interactive only with a terminal on stdin and stderr, no `CI`,
  and no `--json`. `Mode.browser` also needs no SSH session. There is no `--non-interactive` flag.
- Without interaction, missing input fails at once as `missing_input`, naming the option to pass
  (`Can't trust <FOLDER> without --yes in non-interactive mode.`).
- Prompt only for a real choice; never ask for intent the command already expressed. Every prompt
  has an option equivalent. Ask one concept at a time, show the context before the question, mark
  defaults `(default)`, mask secrets. Prompts go to stderr.
- Escape and Ctrl+C cancel. Escape never means back.
- Consent tiers:
  - Ordinary: no confirmation. Removing one named entry (`mcp remove`, `skill remove`) is
    ordinary; asking anyway teaches people to say yes.
  - Destructive (`account unlink`, `trust`, a rollback through `update <VERSION>`): a preview, then
    `confirm`'s `? …? (y/N)`, or `--yes` without a terminal.
  - Severe: a preview, then typing the exact name.
- A preview lists the exact target and each effect on its own line, with counts (`Remove 5
  records?`, never "selected"), and ends with `This cannot be undone.` when that is true.

## Output

**Streams.** stdout holds only the requested result: the data for a query, or the bare ID, path
or value for a mutation, so `x=$(nyte …)` works. Context, receipts, progress, prompts, warnings,
errors and next steps go to stderr.

**JSON.** `--json` exists only on actions that declare it. The result is one document on stdout,
indented on a terminal and compact otherwise. A failure prints one compact error document on
stderr: `{"status","reason","message","next","data"}`, where `status` is `action_required` or
`error` and each `next` entry is `{"command","argv","when"}`. Print mode's `--json` streams JSON
lines; its root help notes are the contract.

**Transcript order.** Use only the phases a task needs: context, input, preview, work, result,
next. The result leads with the outcome and the main destination.

**Gutter.** Column 0 holds a glyph or a space, content starts at column 2. Rows put the label in a
fixed 16-column field and start the value at column 18; a longer label puts its value on the next
line at column 18. Use `formatRows` and `formatStatus`, never hand padding.

| Gutter   | Rich  | Plain      | Meaning                                    |
| -------- | ----- | ---------- | ------------------------------------------ |
| `none`   | space | nothing    | context, preview, secondary rows, progress |
| `done`   | `✓`   | nothing    | the one primary completed result, once     |
| `warn`   | `!`   | `Warning:` | warning                                    |
| `fail`   | `✗`   | `Error:`   | fatal error headline                       |
| `prompt` | `?`   | `?`        | prompt                                     |

```text
✓ Added github
  Scope           user

  Check that it connects:
    nyte mcp list
```

Labels take no colon. A blank line separates phases. No emoji, no `Error:` prefix in rich output,
no `Success!` banners.

**Tables.** `formatTable`. Include the ID the next command needs. Plain output keeps the header,
separates columns with tabs and never pads or truncates; rich output pads and shortens only the
last column with `…`. Never shorten the only copy of an ID, URL, path or command. A list inside a
receipt or error shows at most 5 items, then `and 12 more` and the command that lists them all.

**Empty is success.** `No MCP servers.` plus the command that adds the first one, exit 0. Zero
reads `No servers`, never `0 servers`. A denied or failed read is an error, never an empty state.

**Colour.** Meaning lives in the wording and order; stripped of styling, the output still reads.

- `resolvePresentation` decides per stream: `NO_COLOR` turns colour off, else `FORCE_COLOR`
  (unless `0` or `false`) turns it on, else colour follows rich, which needs a terminal and a
  `TERM` other than `dumb`. `CI` doesn't affect colour. Turning colour off removes only colour.
- `paint` has bold and the basic colours, on the terminal's own background. Green, yellow and red
  go only on the `✓`, `!` and `✗` glyphs. Bold marks the primary result's text and help headings
  and entries. Help headings are magenta. Cyan marks a runnable command on its own line. Values,
  IDs and paths stay plain. Never recolour logs or remote text.

**Width.** Measure on the destination stream, 80 columns when unknown. It must still work at 40.
Never break or shorten a command, URL, ID or path.

**Numbers.** Ages are relative under 7 days (`2m`, `3d`), absolute after. Durations are compact in
tables (`42ms`, `2m 10s`), spaced in sentences (`42 ms`). Counts use correct plurals (`1
project`, never `project(s)`) and commas from 1,000. Sizes use decimal units (MB).

## Writing

| Surface      | Pattern                                  | Example                                     |
| ------------ | ---------------------------------------- | ------------------------------------------- |
| Help summary | imperative, no period                    | `Trust a folder's project files`            |
| Question     | short, ends in `?`                       | `Trust ~/code/app?`                         |
| Confirmation | action, exact object, consequence        | `Install 0.2.0 over 0.3.1?`                 |
| Progress     | present participle + `…`                 | `Starting a Nyte host…`                     |
| Receipt      | past tense + target                      | `✓ Removed github`                          |
| Next step    | benefit + `:`, command on the next line  | `See your servers:`                         |

- Name the thing. State the constraint instead of blaming the user.
- Banned. Hype: seamlessly, powerful, robust, leverage. Filler: just, simply, please. Vague
  outcomes: successfully, Done!, OK, Something went wrong. Interjections: Oops. Vague prompts:
  Continue?, Are you sure?. No `!` in CLI-written text.
- Sentence case for prose and statuses, Title Case for aligned labels and table headers. ASCII
  quotes. One `…` character for ongoing work.
- Next steps: one, or a single `Next steps:` list, checked against the current state.

## Errors

`formatError` lays out every `CliError`:

```text
✗ <What failed, then the known cause.>
  <Detail rows>

  <Recovery label>:
    <command>
```

- Headline: the failed action and its exact object, then the cause, 100 characters or fewer.
  `Can't` for a present blocker, `Couldn't` for a failed attempt, `Failed to` for a system failure.
  No status codes, raw payloads or stack traces.
- Recovery: at most 2 next steps, likeliest first, each an exact command from argv. Never a bare
  "try again". The whole error fits in 8 lines.
- Validate all local input before the first request, and before starting a host.
- Exit codes come from the reason's class in `REASONS`: `usage` and `missing_input` (which
  includes `host_not_running`) exit 2; `auth`, `permission`, `not_found`, `conflict`, `network`,
  `platform`, `unknown_outcome` and `bug` exit 1; `canceled` exits 130; a signal exits 128 + n.
  Never exit 0 after a failure. A plain `Error` reaching the entry is `failed`, exit 1; give it a
  reason when you touch its command.
- Unknown outcome: say what may still be running and recover by inspecting, never by retrying.
- Cancel isn't a failure: no `✗`. `Canceled. Nothing changed.` when nothing started; otherwise
  `Stopped waiting.`, the confirmed facts, and what changed.
- Warnings: `!` gutter, the consequence and the fix, printed once. Never a warning and an error for
  the same condition.
- Remote text (names, host and provider messages, model output, server stderr) never goes in the
  headline or the next command. Pass it through `printable`, which escapes control characters,
  and show it in a row such as `Host reported`.

## Long-running work

- Respond within 100 ms. `Output.progress` names the phase (`Starting a Nyte host…`). A progress
  bar needs a real total; never invent a percentage.
- Progress redraws one line only when interactive with a rich stderr. Otherwise each phase change
  prints once.
- Past the usual duration, say so once and name what it waits on. Never `This might take a while`.
- The first Ctrl+C stops local work and restores the terminal; a second exits at once. Ending a
  local wait never claims the remote work was canceled.
- Follow modes print `! Lost connection. Retrying automatically…` once, back off up to 30 s, and
  warn about the gap after reconnecting.

## Checking a change

- Transcripts before and after at 40, 80 and 120 columns, with long and Unicode values, rich and
  plain.
- Every mode the change touches: terminal, stdout redirected, stdin piped, `--json`, `CI`, and an
  agent's Bash tool. Assert whether a prompt appeared, what each stream holds, and the exit code.
- Check styling with `NO_COLOR` and `FORCE_COLOR` cleared. Stripping ANSI must recover the exact
  text.
- Put a new rule in the shared shell (`resolveMode`, `format`, `CliError`, `Output`), not in one
  command.
