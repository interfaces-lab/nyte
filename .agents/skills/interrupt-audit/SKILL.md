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

This audit looks for the defects a package-by-package review misses: the host, core and a client
each do something reasonable and the user still sees something wrong. It produces findings, not a
document. Don't write down again what the code already says.

## Ground rules

- Stay read-only in this checkout unless the user asked for fixes.
- Never drive the user's own app or host. Their sessions run in that host, and quitting the app
  doesn't stop them. Use the verify-nyte skill's runners, or a throwaway script with an isolated
  `HOME` and `NYTE_HOME`.
- Read [known-gaps.md](known-gaps.md) before reporting, and don't report an entry again.

## The grid

Pick one feature. Answer every interrupt at every phase it can reach. "No effect" is an answer; an
empty cell isn't.

### Phases of a turn

1. **Composing.** What the composer accepts, which model is chosen, what the draft keeps.
2. **Settled without a run.** An empty composer, a command the client resolves, a refused send.
   Say whether anything reached the host.
3. **Sent and the run begins.** Name the moment after which stopping is no longer free.
4. **While the run streams.** Text, tool calls, approvals, questions, subagents, a new message.
5. **The run ends.** Completed, stopped or failed: what is kept, what is unread, what a queued
   message does next, where focus lands.

A gesture (dragging a pane tab, resizing a split, design mode) has its own phases: press, release
without dragging, drag begins, while dragging, drop.

### Interrupts

1. **Stop.** The Stop button, its shortcut, or the TUI's interrupt key.
2. **Another message during the run.** Steer, queue, or editing or removing a queued message.
3. **The user moves away.** Switching chat, pane tab or window tab, closing the pane or the chat,
   opening a blank.
4. **History changes under the turn.** Editing an earlier message, retry, making or switching a
   branch, fork, restore.
5. **The run waits on the user.** An approval or question left unanswered, answered late, or
   answered from another client.
6. **The connection drops and returns.** The network goes away, the machine sleeps, the host
   restarts or retires.
7. **The model fails.** A provider error, a rate limit or quota, expired credentials, a context
   too long for the model.
8. **The client goes away.** The window reloads or closes, the app quits, the TUI exits. The run
   keeps going in the host; say what the user finds when they come back.
9. **The host goes away mid-run.** The host process is killed or crashes, or the machine restarts.
10. **Something else changes the target.** The same chat open in another client, a subagent's
    answer arriving, files changed on disk, the chat archived or deleted elsewhere, the folder
    removed.

### Where the answer may change

Ask each cell again for the states that change it:

- the chat's state: blank, idle, running, waiting on an answer, a subagent's chat, a fork, a
  branch other than main
- the send key and the running-message preference
- the folder: git or plain, trusted or not, in a project or not
- what the message carries: mentions, files, images, pasted text
- for a host that goes away, whether the next host runs on the same machine

Then ask what it touches elsewhere: who may write to the checkout, parent and child chats, several
clients on one host, unread and notifications, what is restored on relaunch.

## Each answer

- What the user sees, in the UI words of the naming skill's glossary.
- The function that decides it, as `path:line`.
- Proof, as far down as is cheap: the test that asserts it, by name; a runner or script you ran,
  with its output; or `unproven`.

Three conditions look alike and aren't:

- A second desktop window shares the desktop's main process, so it is not a second client. Use
  the TUI or the web app on the same host for that.
- The network removed and the host stopped are different. Say which one you tested.
- Use the scripted provider for any claim about structure, order or timing. A real model is only
  for provider failures, limits and sign-in.

## Findings

A finding has the steps that reproduce it, the cause at `path:line`, a severity, and the decision
it needs: a fix or a product call. Merge findings that share a root cause. When a check fails,
say whether Nyte or the expectation is wrong.

`high` is anything that loses a message or a draft, runs a tool the user didn't approve, writes to
a checkout another chat owns, leaves a run going that the user believes is stopped, or shows
different state in two clients of one host.

A gap that is real and stays unfixed gets an entry in [known-gaps.md](known-gaps.md) with what it
would take. File to Linear or GitHub only when asked.

**Reply.** The cells that failed or stayed unproven, the findings, and what you didn't cover.
