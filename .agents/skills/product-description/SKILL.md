---
name: product-description
description: Build or extend a product description of Nyte, a set of prose documents that say, feature by feature and event by event, what a Nyte user sees, what they can do and exactly what happens when they do it, including when they stop halfway. Drafted from this checkout's code and tests, checked against a running Nyte with hand-verification checklists, and collected into a bug triage file. Use for "write a product description of Nyte", "describe how the composer behaves for the user", "document what Stop does everywhere", "add a document for {feature}" or "continue the product description". Not for API or SDK docs, and not for the published docs site.
---

# Nyte product description

From the user's side, Nyte is a large state chart: a chat they type into, a run that streams back, a workbench beside it, and a host underneath that keeps going when the window closes. Most of that behavior is implicit, spread across the app's stores, core's engine, the host and their tests. Nothing says in plain language "when the user does X, this happens, and this is what happens if they do Y halfway through."

The product description is that place. It lives in its own repo, outside this checkout. Every document follows one skeleton, so gaps and inconsistencies show up by comparison. Documents are drafted from this checkout's code and tests, verified by hand against a running Nyte, and everything that looks wrong goes into one triage file.

The files under `references/` are the product-neutral skeletons. This file supplies every Nyte answer they leave open; fill their `{placeholders}` from the sections below, never from guesses.

| File | What it is |
| --- | --- |
| `README-template.md`, `goal-template.md`, `glossary-guide.md` | Skeletons for the three files that steer the build |
| `document-template.md` | The eight-section skeleton every feature document follows |
| `verification-template.md`, `bug-triage-template.md` | Skeletons for the checking half |
| `check-links.py` | Link and anchor checker for the consistency pass: `python3 check-links.py {repo}` |

## Outputs

```
README.md            purpose, conventions, document template, method, structure, coverage table
goal.md              standing instructions for whoever drafts (you, subagents, a later session)
glossary.md          the vocabulary, keyed to Nyte's own glossary
AGENTS.md            "Read README.md, then goal.md. The coverage table in README.md is the work list."
CLAUDE.md            "Read @AGENTS.md."
foundations/ chat/ workbench/ layout/ sidebar/ settings/ projects/ cross-cutting/
verification/        README.md (protocol) and one checklist file per cluster
bug-triage.md        every suspected defect, deduplicated, with repro, cause, severity and the decision needed
```

## Nyte's shape

These are the four decisions `document-template.md` leaves open. They are made here, once. Write them into the README's "Document template" section and the glossary before the pilot, and don't change them afterwards without revisiting every document.

### Unit of interaction: the turn

The unit is a turn: the work one message causes. The five phases, in Nyte's words, are the subsection headings of "The interaction, event by event":

1. **Composing.** The composer in a chat or a blank pane. What it accepts (text, mentions, files and images, pasted content, slash commands, skills), which model and reasoning level are chosen, what the draft keeps per pane, and what Enter, Shift+Enter and Cmd/Ctrl+Enter do.
2. **Settled without a run.** The short path: an empty composer, a command the client resolves itself, a send refused (no model signed in, an untrusted folder). Say whether anything reached the host, and say so when nothing did.
3. **Sent and the run begins.** The message appears, a blank pane becomes a chat, the host accepts it and starts a run. Name the moment after which stopping is no longer free.
4. **While the run streams.** Text, thinking and tool calls stream in and group into steps. Tools change files. Approvals and questions wait in trays. Subagents start. A new message steers or queues. The context may be compacted. Say what the user can still do: scroll, switch chats, type the next message, open the workbench.
5. **The run ends.** It completes, is stopped or fails. Say what is kept, what the transcript and Changes show, whether the chat is marked unread or sends a notification, what a queued message does next, and where focus lands.

Workbench and layout features (dragging a pane tab, resizing a split, design mode in the browser panel) are gestures. Their documents rename the same five slots to *press*, *release without dragging*, *drag begins*, *while dragging* and *drop*, and keep the same order.

### Variant axis

These are the rows of every Modifiers table, in this order. The columns are "Set before sending" and "Changed while the run streams".

1. **Model and reasoning level** chosen in the composer.
2. **The send key and the running-message preference.** Enter sends when the chat is idle. While a run streams, Enter steers or queues depending on the preference, and Cmd/Ctrl+Enter does the other. Shift+Enter adds a new line.
3. **The chat's state.** Blank, idle, running, waiting on an answer, a subagent's chat, a fork, or on a branch other than main.
4. **The folder and project.** A git checkout or a plain folder, trusted or not, in a project (with the project's models, instructions, skills and MCP servers) or not.
5. **What the message carries.** Mentions, files, images (with or without markup), pasted text.

Gesture documents use the modifier keys instead (Shift, Alt/Option, Cmd/Ctrl) and say so in their table.

### Interrupt list

These are the rows of every Cancel and interrupt table, in this order, in every document, with every cell filled, even when the answer is "No effect."

1. **Stop:** the Stop button, its shortcut, or the TUI's interrupt key.
2. **Another message during the run:** steer, queue, or editing or removing a queued message.
3. **The user moves away:** switches chat, pane tab or window tab, closes the pane or the chat, or opens a blank.
4. **History changes under the turn:** editing an earlier message, retry, making or switching a branch, fork, restore.
5. **The run waits on the user:** an approval or question left unanswered, answered late, or answered from another client.
6. **The connection drops and returns:** the network goes away, the machine sleeps, the host restarts or retires.
7. **The model fails:** a provider error, a rate limit or quota, expired credentials, a context too long for the model.
8. **The client goes away:** the window reloads or closes, the app quits, the TUI exits. The run keeps going in the host. Say what the user finds when they come back.
9. **The host goes away mid-run:** the host process is killed or crashes, or the machine restarts.
10. **Something else changes the target:** the same chat open in another window or client, a subagent's answer arriving, files changed on disk by the user or another chat, the chat archived or deleted elsewhere, the folder removed.

Rows 1–3 are the user's own abort or change of mind, 4 and 10 are the target changing, 5 is the input channel changing, and 6–9 are the environment failing. Define every bolded word in the glossary's "Events that end or interrupt" section.

### Cross-cutting concerns, in order

These are the bold-led paragraphs of "Interactions with other systems", in this order, in every document:

1. **Folder and trust:** what the agent may touch, and which approvals apply.
2. **History:** branches, edit and retry, fork, restore, snapshots, Changes.
3. **Parent and child chats:** subagents, projects and their coordinator.
4. **Who may write:** the checkout's writer family, archived chats.
5. **Offline and reconnection:** messages typed offline, resuming after a reconnect.
6. **Several clients on one host:** a second desktop window, the TUI, the web app, a phone.
7. **Unread and notifications.**
8. **Settings and configuration:** model defaults, AGENTS.md instructions, skills, MCP servers, plugins, project settings.
9. **Context and usage:** compaction, limits, usage reports.
10. **Layout:** panes and splits, warm chats, what is restored on relaunch.
11. **Accessibility:** keyboard reach, focus, screen readers, reduced motion.

## Phase 0: scope

Settle these before writing a file. Ask only what the conversation and the checkout can't answer. Record the answers in the README's "Scope decisions".

1. **Surface.** One client per repo. The default is the desktop app on macOS: a fresh home, one model provider signed in, one git folder added, every setting at its default. The TUI, the web app and mobile are separate repos. Behavior the host decides (runs, Stop, reconnection) is the same in every client, so describe it once in a foundation and link to it.
2. **Source of truth.** This checkout, read-only. Record `git rev-parse --short HEAD` and whether the tree is dirty. Nyte moves fast, so pin one commit for the whole first pass.
3. **Where to run it.** See "Verification" below. Never the user's own app or host unless they ask.
4. **Out of scope by default:** the SDK and the host protocol (they have their own docs), writing plugins, the parts of the project workflow the glossary marks as planned (triggers, babysitters, keepers, remedies), sharing a host over the tailnet, and mobile. Confirm the list with the user.
5. **Where the repo goes.** A new directory outside this checkout, for example next to it, then `git init` and an `Initial commit`.

Then do a reconnaissance pass. Read Nyte's own maps first, in this order: the glossary, the field guide (how a message travels from client to host and back, with its clocks and its known gaps), the app structure (which app folder owns which concept) and the core structure. They name where each feature's state lives. For each area, find:

- **The UI and its state:** the app folder that owns the feature, its store under the app's data layer, and the window commands that bind its shortcuts.
- **Where the behavior is decided:** the composer's key and send logic, the send journal in the SDK, admission, driving and ending runs in core, the agent turn and its tool runner, the workbench reducer and the pane layout.
- **The tests that read as specs:** browser and Electron tests beside the app files, the desktop e2e chapters (one per area: composer, chat, panes, workbench, subagents, host restart and others), the TUI journeys run through `startTui`, and core's tests on the `@nyte-ai/bench` models. The verify-nyte skill's feature map points from features to these tests.
- **Defaults and thresholds:** stored preferences, the desktop settings in the app's contract, the settings and project schemas, and the timings the field guide lists.
- **What the published docs promise.** Read the user docs in the docs package. Where they and the code disagree, that is an open question, not a choice.

## Phase 1: scaffold

Write, in this order:

1. **README.md** from `README-template.md`. The structure section is the plan: every document you expect to write, one line each, grouped by how the user meets it and never by package. Start from this outline and reshape it after reconnaissance:
   - `foundations/`: the host and its clients, the chat model, the turn and its interrupts, the window and its layout, the composer and drafts, models and sign-in.
   - `chat/`: sending, the running turn, steer, queue, Stop, approvals, questions, edit and retry, branches, fork, restore, subagents, the transcript, image markup.
   - `workbench/`: editor, Changes, terminal, browser and design mode.
   - `layout/`: window tabs, panes and splits, moving pane tabs.
   - `sidebar/`: the chat list, search, unread.
   - `settings/`: models and accounts, Customize (plugins, skills, MCP), the server and its devices.
   - `projects/`: creating a project, its coordinator, shared docs.
   - `cross-cutting/`: one document per concern above that needs more than a paragraph (offline and reconnection, several clients, notifications, configuration precedence).

   The coverage table lists every document as `not started`.
2. **glossary.md** from `glossary-guide.md`. Use the UI word as the term (Chat, Message, Branch, Fork, Folder, Tab, Draft, Subagent, Project) and give Nyte's code term beside it, from Nyte's glossary. Honor that glossary's "Don't use" column: a document never says "thread", "conversation" or "directory" for a chat or a folder. Add the interrupt words above in their own section.
3. **goal.md** from `goal-template.md`. Its reading order is the reconnaissance list above. Its "Things already established" section starts empty.
4. **AGENTS.md** and **CLAUDE.md** with the one-line contents under Outputs.

Commit: `docs: add README, glossary, goal`.

## Phase 2: pilot, foundations, the hard part

Do these yourself, in order, not in parallel. They fix the template, tone, depth and vocabulary everything else copies.

1. **Pilot: queueing a message.** It is small and self-contained, and it has all five phases: composing while a run streams, an empty queue, the message queued, the queue while it waits (edit, remove, reorder, switch to steer), and the queued message starting the next turn when the run ends. It also meets nearly every interrupt row, which tests the table. Write it on the full eight-section template and iterate until it's right. Expect about 150–200 lines with every phase narrated and every cell filled. If a section is thin, the code hasn't been read closely enough.
2. **Foundations.** They own the facts other documents link to. The host and its clients comes first, because the fact that a run outlives its window changes the answer to rows 6–9 everywhere. The turn and its interrupts owns the definition of Stop, steer, queue and answer and what each keeps. As each foundation lands, add its load-bearing facts (defaults, keys, what "sent", "stopped" and "unread" mean) to goal.md's "Things already established".
3. **The hardest area: the composer and the running turn.** Sending, streaming, tool calls and steps, approvals and questions, steer, Stop and subagents. Read the composer's situations, the send path and the run's lifecycle end to end before writing any of it. The states hand off to each other, and the documents must agree on where one ends. Decide which document owns each state (composing, sending, streaming, waiting on the user, ending) and write that into goal.md.

Commit after each document or coherent group: `docs: add {path}`.

## Phase 3: draft the rest in parallel

Once the exemplars exist, fan out with subagents, one document or a small cluster each. Each subagent gets this prompt:

> Read `goal.md`, `README.md`, `glossary.md`, `chat/queue.md` and `{the foundation this feature depends on}`. Nyte's source is the checkout at `{absolute path}`, commit `{sha}`. It is read-only. Write `{area}/{feature}.md` on the same skeleton, at the same depth, with the same Modifiers rows, interrupt rows and cross-cutting order. Use the glossary's words. If you need a term it lacks, add it to `glossary.md` with a full definition instead of coining a synonym. Don't edit any other existing document. Don't start Nyte, a dev server or a host. End with "## Open questions and verification" and the footer. Report what you couldn't determine from code and tests.

Review every result yourself before accepting it. Check that the glossary words are used correctly, established facts aren't contradicted, links resolve, the footer is present, every interrupt row is filled and suspected bugs are stated plainly. Mark each one `drafted` in the coverage table. Commit in groups.

## Phase 4: consistency pass

Over the whole set:

- The same word for the same thing everywhere, every term defined, and the glossary matching the documents and Nyte's own glossary.
- No two documents describe one behavior differently. Where two touch, one owns it and the other links.
- `python3 {skill dir}/references/check-links.py {repo}` exits 0.
- Every document has the footer, the ten interrupt rows in order and the eleven cross-cutting paragraphs in order.
- The README structure and the coverage table match the files on disk exactly.

Commit: `docs: revise the set after the consistency review`. Then deepen the documents whose open questions were thinnest.

## Phase 5: verification checklists

Drafting reads the code, verification watches Nyte. Build `verification/` from `verification-template.md`, using these Nyte answers.

**Bringing up the surface.** Never use the user's running desktop app or host. Their sessions run in that host, and quitting the app doesn't stop them. A pass uses its own home:

- **Scripted, for an agent:** the verify-nyte skill's runners. The desktop e2e chapters launch a built app on an offline scripted provider with a temporary HOME and their own host. TUI journeys mount the whole TUI through `startTui` over an in-process host with fake models. The binary smoke covers pipes, print mode and exit codes. The web app has its own e2e command. Follow that skill's build order and port checks, and record the commit and build.
- **By hand, for a tester:** a built desktop app or `pnpm dev:live`, always with an isolated `HOME` and `NYTE_HOME`, one model provider signed in, one throwaway git folder.

**The Device column** uses these values, and `verification/README.md` says how to get each and its trap:

- `desktop`, `tui`, `web`, `phone`: the client.
- `second-window`: a second desktop window. It shares the desktop's main process, so it is not a second client. Use `second-client` for that (the TUI or web app on the same host).
- `offline`: the network removed, or the host stopped, with a note of which. They aren't the same condition.
- `host-restart`: the host stopped and started again.
- `scripted-model` or `real-model`: use the scripted provider for any claim about structure, order or timing. A real model is needed only for claims about provider failures, limits or sign-in. Items about a real model's output check structure and state, never wording.
- `git-folder` or `plain-folder`, and `project` when the item needs one.

If you can drive Nyte (the e2e runners, the TUI harness, the binary), run a first pass on what those observe, record results, and say exactly what the pass couldn't see: an offline scripted provider shows nothing about real latency, and a TUI test frame isn't the desktop. Never mark a document `verified` on an automated pass alone. A failed item isn't automatically a Nyte bug. Sometimes the document is wrong, and the Status line says which.

## Phase 6: bug triage

Build `bug-triage.md` from `bug-triage-template.md`. Merge by root cause, pin each cause to a file and line range at the pinned commit, and assign a severity and a decision (`fix` or `product call`).

For Nyte, `high` also covers anything that loses a message or a draft, runs a tool the user didn't approve, writes to a checkout another chat owns, leaves a run going that the user believes is stopped, or shows different state in two clients of one host.

**Filing is a separate, outward-facing step.** Offer it, and don't do it unasked. Ask whether entries go to Linear (and which team) or to GitHub issues on the Nyte repo. Confirm the format, then file, and add the Issue lines.

## Resuming and extending

A later session, or a request to add a feature, starts here.

1. Read the description repo's `AGENTS.md`, `README.md`, `goal.md` and `glossary.md`, then the pilot to recalibrate depth.
2. Compare the pinned commit with this checkout's `HEAD`. If Nyte has moved, decide with the user whether new documents cite the new commit (and say so in their footer) or the repo stays pinned. Never mix them silently. When a renamed concept shows up in Nyte's glossary, update the description's glossary and every document that uses the old word in one commit.
3. To add a document: add it to the structure and coverage table, write it, add its checklist table (new ID prefix from 01), add triage entries with the next `B-NN`, and commit each step.
4. Never renumber checklist or triage IDs once a pass or an issue has used them.

## Writing rules (carry into goal.md)

- Describe the experience, not the code. "The message appears in the transcript dimmed until the host has it," not "`withUnsent` overlays the journal entry." "Closing the window doesn't stop the run," not "the run's lease lives in the host worker."
- Technical detail only in `> Technical note:` block quotes, and only when the mechanism changes what the user would expect. A note may name a symbol. Leave file paths to the triage file, where they're pinned to a commit.
- Use UI words in the prose and Nyte's code terms only in technical notes, both as the glossary pairs them.
- Sentence case for headings. Direct and concrete, with no hedging and no marketing.
- State surprising behavior plainly, with the reason if the code or a comment gives one. If it looks like a bug, say so in "Open questions".
- Variants and interrupts go in tables, split by phase, with every cell filled.
- Cross-reference with relative links instead of repeating. The foundations own definitions and defaults.
- One Mermaid `stateDiagram-v2` per interaction, with only the states the user passes through (`composing`, `sending`, `streaming`, `waiting`, `stopped`, `done`). Leave out internal ones like leases and receipts.
- Footer: `## Open questions and verification`, a bullet list, then `Verified against nyte commit \`{sha}\``.
- Commits in the description repo: `docs: add {path}` or `docs: revise {path}`.
- Never modify this checkout. Don't start Nyte, a dev server or a host outside an isolated home.
- When behavior can't be determined from code and tests, write what can be, put the rest in "Open questions" and move on.

## What never changes

The outside-in stance. One skeleton for every document. The ten interrupt rows asked of every feature in the same order. A glossary that owns the words and agrees with Nyte's. Foundations first, so they own the facts. A pilot that sets the depth. Drafting from code and tests, then verifying against a running Nyte in its own home, then triaging what looks wrong.
