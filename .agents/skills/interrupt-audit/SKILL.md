---
name: interrupt-audit
description: >
  Audit one Nyte feature from the user's side, one interrupt at a time: what the user sees when a
  turn is stopped, steered, left, rewound, kept waiting, cut off or failed, the function that
  decides it, and the test or run that proves it. Use for "what happens if the user does X
  halfway", "audit how Stop behaves", "walk the interrupts for {feature}", or a behaviour audit
  across host, core and clients. Not for API docs or the published docs site.
---

# Interrupt audit

Hunt for defects that only show across host, core and client.

## Ground rules

- Stay read-only unless the user asked for fixes.
- Never drive the user's own app or host. Use the verify-nyte runners or a throwaway script with an isolated `HOME` and `NYTE_HOME`.
- Read [known-gaps.md](known-gaps.md) first and don't report its entries again.

## The grid

Pick one feature. Answer every interrupt at every phase it can reach. "No effect" is an answer; an empty cell isn't.

**Phases**

1. Composing: input accepted, model chosen, what the draft keeps.
2. Settled without a run (empty composer, client-resolved command, refused send): did anything reach the host?
3. Sent, run begins: when stopping stops being free.
4. Streaming: text, tool calls, approvals, questions, subagents, a new message.
5. Ended (completed, stopped, failed): what is kept or unread, what a queued message does, where focus lands.

Gestures (pane tab drag, split resize, design mode): press, release without drag, drag start, dragging, drop.

**Interrupts**

1. Stop: button, shortcut, TUI interrupt key.
2. Message mid-run: steer, queue, edit or remove a queued one.
3. Moving away: switch chat, pane tab or window tab; close pane or chat; open a blank.
4. History change: edit an earlier message, retry, make or switch a branch, fork, restore.
5. Waiting on the user: approval or question unanswered, answered late, answered from another client.
6. Connection lost and back: network loss, machine sleep, host restart or retirement.
7. Model failure: provider error, rate limit or quota, expired credentials, context too long.
8. Client gone (reload, window close, app quit, TUI exit) while the run continues: what the user finds on return.
9. Host gone mid-run: killed, crashed, machine restart.
10. Target changed elsewhere: chat open in another client, subagent answer, files changed on disk, chat archived or deleted, folder removed.

**Axes.** Re-ask each cell for:

- chat: blank, idle, running, awaiting an answer, a subagent's, a fork, a non-main branch
- send key, running-message preference
- folder: git or plain, trusted or not, in a project or not
- message: mentions, files, images, pasted text
- host loss: next host on the same machine or another

Then side effects: who may write to the checkout, parent and child chats, several clients on one host, unread and notifications, what relaunch restores.

## Each answer

Give what the user sees in the UI words of the naming skill's glossary, the deciding `path:line`, and the deepest cheap proof: a test by name, a runner or script you ran with its output, or `unproven`.

- A second desktop window shares the main process, so it is not a second client. Use the TUI or web app on the same host.
- Network removed and host stopped differ; say which you tested.
- Use the scripted provider for structure, order or timing claims, a real model only for provider failures, limits and sign-in.

## Findings

- Each has reproduction steps, the cause at `path:line`, a severity, and the decision it needs (fix or product call). Merge findings with one root cause.
- When a check fails, say whether Nyte or the expectation is wrong.
- `high`: loses a message or draft, runs an unapproved tool, writes to another chat's checkout, leaves running a run the user believes stopped, or shows two clients of one host different state.
- Log a real gap that stays unfixed in [known-gaps.md](known-gaps.md) with what fixing it takes. File to Linear or GitHub only when asked.

Reply with findings, not a document that restates the code: the failed or unproven cells, the findings, and what you didn't cover.
