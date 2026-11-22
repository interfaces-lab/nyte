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

"Should" allows a departure with a stated reason. Every other rule is a must.

packages/tui/AGENTS.md names the shell pieces (`resolveMode`, `Output`, `CliError`, `COMMANDS`). This skill says how what they produce should read.

There are two surfaces:

- **One-shot commands.** `trust`, `untrust`, `login`, `logout`, `status`, `account`, `mcp`, `api`, `skill`, `host`, `events`, `update`, `doctor`, `triage`, and print mode (`-p`). Every rule applies.
- **The full-screen app.** It has no stdout contract. The writing, error, progress, prompt and cancel rules apply to the text it draws.

## The bar

Every command answers four questions, for the person and for the script calling it:

1. **What will it act on?** Show the resolved target before anything consequential happens.
2. **What will change?** Show broad or risky effects before they happen.
3. **What happened?** Report the real outcome in the output and in the exit code: done, pending, no-op, partial, canceled or failed.
4. **What next?** Give one exact, working command when there is a next step.

Seven principles:

1. **Capability first.** A capability means the same thing in the CLI, SDK and app.
2. **One concept, one name.** One noun per concept, one verb per operation.
3. **Resolve before acting.** Never guess, fuzzy-match, or create a target to fill in missing input.
4. **Interaction, consent and format are independent.** Prompts need a terminal. `--yes` grants consent but supplies no data. `--json` picks a format and turns off prompts but grants no consent. Redirecting stdout changes none of them.
5. **stdout is the answer.** Everything else goes to stderr.
6. **Report reality.** Accepted work isn't finished work. The exit code matches the outcome.
7. **Protect people and data.** Secrets never leak. Destructive work needs proof of intent. Remote text is data, never instructions.

Invariants:

- Help works before auth, config, network or a host. It does no work.
- Explicit invalid input fails. It never falls back to a default.
- Nothing durable changes before validation and consent.
- Retries, waits and reads are bounded. A retry never repeats an unsafe mutation.
- Reads never start a host. They fail with `host_not_running`. `doctor` reports a missing host as a check.

## Commands, options, help

- **Grammar.** `nyte <command> [<action>] [options]`. Groups are nouns (`mcp`, `api`, `skill`, `account`). Top-level verbs act on this machine or folder (`login`, `trust`, `update`). Never fuse a verb into a noun.
- **Verbs.** Name a verb for its consequence. Reuse it in the prompt, the receipt and the JSON (`Unlink this machine…?`, `✓ Unlinked`, `"outcome"`).
- `delete` destroys. `remove` takes out an entry. `revoke` invalidates a credential. `stop` can start again. `cancel` aborts in-flight work.
- **Options** are kebab-case and declared in `COMMANDS`. They go on the group when every action takes them, otherwise on the action.
- `--a=b` and `--a b` both work. A lone `-` reads stdin. Prefixes never match.
- An unknown option or action fails before any work, with at most one "Did you mean".
- An unknown word is a usage error, never a prompt. A prompt argument needs `-p`.
- **Help.** `-h` and `--help` anywhere, `help <path>`, `<path> help`, and a group with no default action all reach the same page. It goes to stdout with exit 0. `help <unknown>` exits 2.
- **Page order.** `Usage:` line, one-line summary, Commands, Options (alphabetical), Global Options, Examples, Notes. The root lists the global options. Every other page points to `nyte --help`.
- Headings are Title Case with a colon. Entries indent 2. Pages wrap at 80 columns or less and read the same without colour.
- **Examples.** A label ending in `:`, then the command on the next line, indented 4. Use canonical names and long options, `<UPPER_CASE>` placeholders and no `$`. Build them from argv so they parse.

## Interaction and consent

- `resolveMode` decides. A run is interactive only with a terminal on stdin and stderr, no `CI`, and no `--json`. `Mode.browser` also needs no SSH session. There is no `--non-interactive` flag.
- Without interaction, missing input fails at once as `missing_input`. It names the option to pass: `Can't trust <FOLDER> without --yes in non-interactive mode.`
- Prompt only for a real choice. Never ask for intent the command already expressed.
- Every prompt has an option equivalent.
- Ask one concept at a time. Show the context before the question. Mark defaults `(default)`. Mask secrets.
- Prompts go to stderr.
- Escape and Ctrl+C cancel. Escape never means back.

Consent tiers:

- **Ordinary.** No confirmation. Removing one named entry (`mcp remove`, `skill remove`) is ordinary. Asking anyway teaches people to say yes.
- **Destructive** (`account unlink`, `trust`, a rollback through `update <VERSION>`). A preview, then `confirm`'s `? …? (y/N)`, or `--yes` without a terminal.
- **Severe.** A preview, then typing the exact name.

A preview lists the exact target and each effect on its own line, with counts. Write `Remove 5 records?`, never "selected". End with `This cannot be undone.` when that is true.

## Output

**Streams.** stdout holds only the requested result. That is the data for a query, or the bare ID, path or value for a mutation, so `x=$(nyte …)` works. Context, receipts, progress, prompts, warnings, errors and next steps go to stderr.

**JSON.** `--json` exists only on actions that declare it.

- The result is one document on stdout, indented on a terminal and compact otherwise.
- A failure prints one compact error document on stderr: `{"status","reason","message","next","data"}`. `status` is `action_required` or `error`. Each `next` entry is `{"command","argv","when"}`.
- Print mode's `--json` streams JSON lines. Its root help notes are the contract.

**Transcript order.** Use only the phases a task needs: context, input, preview, work, result, next. The result leads with the outcome and the main destination.

**Gutter.** Column 0 holds a glyph or a space. Content starts at column 2. Rows put the label in a fixed 16-column field and start the value at column 18. A longer label puts its value on the next line at column 18. Use `formatRows` and `formatStatus`, never hand padding.

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

Labels take no colon. A blank line separates phases. No emoji, no `Error:` prefix in rich output, no `Success!` banners.

**Tables.** Use `formatTable`. Include the ID the next command needs.

- Plain output keeps the header, separates columns with tabs and never pads or truncates.
- Rich output pads, and shortens only the last column with `…`.
- Never shorten the only copy of an ID, URL, path or command.
- A list inside a receipt or error shows at most 5 items, then `and 12 more` and the command that lists them all.

**Empty is success.** Print `No MCP servers.` plus the command that adds the first one, and exit 0. Zero reads `No servers`, never `0 servers`. A denied or failed read is an error, never an empty state.

**Colour.** Meaning lives in the wording and order. Stripped of styling, the output still reads.

- `resolvePresentation` decides per stream. `NO_COLOR` turns colour off. Otherwise `FORCE_COLOR` turns it on, unless it is `0` or `false`. Otherwise colour follows rich, which needs a terminal and a `TERM` other than `dumb`.
- `CI` doesn't affect colour. Turning colour off removes only colour.
- `paint` has bold and the basic colours, on the terminal's own background.
- Green, yellow and red go only on the `✓`, `!` and `✗` glyphs.
- Bold marks the primary result's text, and help headings and entries. Help headings are magenta.
- Cyan marks a runnable command on its own line.
- Values, IDs and paths stay plain. Never recolour logs or remote text.

**Width.** Measure on the destination stream, and assume 80 columns when unknown. The output must still work at 40. Never break or shorten a command, URL, ID or path.

**Numbers.**

- Ages are relative under 7 days (`2m`, `3d`) and absolute after.
- Durations are compact in tables (`42ms`, `2m 10s`) and spaced in sentences (`42 ms`).
- Counts use correct plurals (`1 project`, never `project(s)`) and commas from 1,000.
- Sizes use decimal units (MB).

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
- Banned hype: seamlessly, powerful, robust, leverage.
- Banned filler: just, simply, please.
- Banned vague outcomes: successfully, Done!, OK, Something went wrong.
- Banned interjections and prompts: Oops, Continue?, Are you sure?
- No `!` in CLI-written text.
- Sentence case for prose and statuses. Title Case for aligned labels and table headers.
- ASCII quotes. One `…` character for ongoing work.
- Give one next step, or a single `Next steps:` list. Check it against the current state.

## Errors

`formatError` lays out every `CliError`:

```text
✗ <What failed, then the known cause.>
  <Detail rows>

  <Recovery label>:
    <command>
```

- **Headline.** The failed action and its exact object, then the cause, in 100 characters or fewer. No status codes, raw payloads or stack traces.
- Write `Can't` for a present blocker, `Couldn't` for a failed attempt and `Failed to` for a system failure.
- **Recovery.** At most 2 next steps, likeliest first, each an exact command from argv. Never a bare "try again". The whole error fits in 8 lines.
- Validate all local input before the first request, and before starting a host.
- **Exit codes** come from the reason's class in `REASONS`.
  - `usage` and `missing_input` exit 2. `missing_input` includes `host_not_running`.
  - `auth`, `permission`, `not_found`, `conflict`, `network`, `platform`, `unknown_outcome` and `bug` exit 1.
  - `canceled` exits 130. A signal exits 128 + n.
  - Never exit 0 after a failure.
  - A plain `Error` reaching the entry is `failed`, exit 1. Give it a reason when you touch its command.
- **Unknown outcome.** Say what may still be running. Recover by inspecting, never by retrying.
- **Cancel isn't a failure.** No `✗`. Print `Canceled. Nothing changed.` when nothing started. Otherwise print `Stopped waiting.`, the confirmed facts, and what changed.
- **Warnings.** `!` gutter, the consequence and the fix, printed once. Never a warning and an error for the same condition.
- **Remote text** never goes in the headline or the next command. That covers names, host and provider messages, model output and server stderr. Pass it through `printable`, which escapes control characters. Show it in a row such as `Host reported`.

## Long-running work

- Respond within 100 ms. `Output.progress` names the phase (`Starting a Nyte host…`).
- A progress bar needs a real total. Never invent a percentage.
- Progress redraws one line only when interactive with a rich stderr. Otherwise each phase change prints once.
- Past the usual duration, say so once and name what it waits on. Never `This might take a while`.
- The first Ctrl+C stops local work and restores the terminal. A second exits at once.
- Ending a local wait never claims the remote work was canceled.
- Follow modes print `! Lost connection. Retrying automatically…` once. They back off up to 30 s, and warn about the gap after reconnecting.

## Checking a change

- Take transcripts before and after at 40, 80 and 120 columns, with long and Unicode values, rich and plain.
- Cover every mode the change touches: terminal, stdout redirected, stdin piped, `--json`, `CI`, and an agent's Bash tool.
- In each mode, assert whether a prompt appeared, what each stream holds, and the exit code.
- Check styling with `NO_COLOR` and `FORCE_COLOR` cleared. Stripping ANSI must recover the exact text.
- Put a new rule in the shared shell (`resolveMode`, `format`, `CliError`, `Output`), not in one command.
