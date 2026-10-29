# Composer audit

Scope: the drafts for the composer area. Those are `workers/03-input-routing.md`, `workers/10-composer-footer.md`, `workers/13-composer-deep.md` and the dock-row parts of `workers/01-attention-in-chat.md`. Each claim was checked against Cursor Glass 3.28.5 (`/tmp/glass/glass.js`, formatted; `glass.css`; `nls.messages.json`) and Nyte `origin/main` at `5aabfa0cd` (`packages/app/src`). Nothing was run. Every finding comes from reading the code.

## Summary

| | Count |
| --- | --- |
| Claims checked | ~120: every row of the state and routing tables in 03 §1/§3, 13 "State model", "Access", "Queue management" and "Running-message policy", plus 01's dock rows; about 40% of the remaining rows, including every Nyte comparison row |
| Confirmed | ~94 (including the dock rank order, 10-prompt history, context-ring tooltip, Hold to Talk on Control+M on all platforms, and the footer defaulting on, which the drafts disputed or under-cited) |
| Corrected | 13 (table below) |
| Dropped or demoted to unknown | 13 |

Overall confidence: **high** for queue, steer, edit, Enter, Esc, stop, placeholders, the child-tab lock and the dock order. Most behaviour rows cite the right line, and the right line says what the row claims. **Medium** for voice and footer, which were spot-checked only. **Low** for anything about appearance (heights, the "faded" message, compact vs expanded composer); runtime has to settle those. The drafts' main weakness is their Nyte comparisons. They looked only at five composer files, so they called features "absent" that Nyte has elsewhere, and they misread Nyte's Escape key.

Missed by every draft and added to the spec:
- The first successful steer shows a one-time 15-second toast: "Your message steered Agent without stopping it" / "New Messages is set to Steer", with an Open Settings action. [code glass.js:451671–451677, 558068; nls 6070–6072]
- A queued row shows a "send key" hint only while the composer is empty. [code glass.js:598124]
- The queue tray closes when you switch chats. Its open state is tracked per chat, and switching resets it to closed. [code glass.js:588428–588432]
- A Ctrl+C typed in the prompt with no text selected stops the agent. The registered shortcut is also turned off while a terminal has focus. [code glass.js:480430–480431, 480122–480124, 882203; terminal context at 370269]
- Default chat width is 780 px plus a 16 px scrollbar gutter, and the user can change it. The 840 px value is only a CSS fallback. [code glass.js:535535, 535540–535544, 540252–540256]

## Corrections

| Report | Claim | Finding | Evidence |
| --- | --- | --- | --- |
| 03 §2, 13 copy | A failed follow-up submit shows "Failed to send follow-up." | **Corrected.** That toast belongs to a second path, "submit without clearing the prompt". A failed normal submit has no toast. It puts the text, rich text, images and videos back into the composer and logs the error. | [code glass.js:562606–562608 (normal), 562610–562622 (other path); return names at 562631] |
| 03 §3, 13 kbd | Unclaimed Esc "falls through to panel dismiss/navigation" | **Made concrete.** Glass sends an unclaimed Esc to the editor side panel. It leaves fullscreen if the panel is fullscreen, and otherwise toggles the panel. While a follow-up tray is active and the panel is hidden, Esc is swallowed, so it never opens the panel. It never stops the agent. | [code glass.js:884583–884584, 585721–585726] |
| 03 §1, §3 | Default Enter while running queues | **Confirmed, with an omission.** Under the shipped defaults, the alternate submit (Cmd/Ctrl+Enter) means **stop and send**, which interrupts the agent. It does not steer. 03's "running, defaults" row leaves that out, and it is the most consequential default. | [code glass.js:324974–324978, 832138] |
| 03 §3 | Policy table covers all cases | **Incomplete.** A submit flagged "prefer steer" overrides a primary submit to steer, and a summarization in progress forces queue. Two rows were added. | [code glass.js:324981–324983, 765960] |
| 03 §1 | Steer: "a human message is appended" | **Confirmed and sharpened.** Steer first adds the message to the queue, then promotes it. The message shows in the transcript right away. If the run declines it, the message leaves the transcript and returns to the queue. One fallback per run can escalate to stop-and-send. | [code glass.js:765971–765972, 766037–766107] |
| 03 §9, 13 | "The faded message cannot be identified" | **Narrowed.** Glass dims a human message only when it comes after a message you are editing, or when review blocks it. Neither queued nor steered messages are dimmed. The faded message the user saw has another cause, so it stays a runtime check. | [code glass.js:479893, 479904; glass.css `.human-dimmed`] |
| 13 | Edit "stashes the prior composer state" | **Mechanism corrected, behaviour confirmed.** While you edit a queued item, nothing is written to the chat's saved draft. Cancel or save restores that saved draft. The prior text comes back, but no separate copy of it is made. | [code glass.js:558547–558549, 562250–562262, 562403] |
| 13 | "Send Now" on a row | **Missing case added.** If the row is being edited, Send Now saves the edit first and then sends it. | [code glass.js:562374–562398] |
| 03 §1 | Locked child tab: "parent not silently substituted" | **Confirmed, and extended.** The same locked state covers "Worktree setup failed". Clearing on read-only applies to both. | [code glass.js:847843–847845, 847909, 684310 (locked flag)] |
| 03 §4 | "Steer without interrupting" shows "when steering presentation is selected" | **Made precise.** It shows when the new-message setting is Steer **and** steering is available right now. While idle, the placeholder stays "Send follow-up". | [code glass.js:684310, 564289–564290, 564318] |
| 01 §2 | Chip-row overflow evidence at 585855 | **Wrong line.** 585855 is a tray slot helper. The overflow and wheel behaviour stays plausible but is unverified, so it was demoted to a runtime check. | [code glass.js:585855] |
| User premise | Composer max width is 840 px | **Corrected.** 840 px is the CSS fallback. Glass sets the chat column at runtime from a user setting: default 780 px plus 16 px scrollbar gutter (796 px), or 976 px in project views. Transcript and composer share that width. | [code glass.js:535535, 535540–535544, 540252–540256, 575194–575196] |
| User premise | `--composer-transcript-column` relates to composer width | **Clarified.** It is a positioning anchor on the transcript content. Floating overlays such as the new-messages pill use it to line up with the transcript's edges. It sets no width. | [glass.css `.virtualized-composer-messages-content-shell`; anchor users with `left/right: anchor(--composer-transcript-column …)`] |

### Dropped or demoted

- 03 §2 "Queue removal failure" and "Queue steering failure" toasts. The strings exist (nls 2176–2177), but they are rarely seen. Folded into one line.
- 03 §7 acceptance steps 1–12. They are too long and repeat each other. Rewritten as 5 journeys.
- 13 "Optimistic pending interrupt" (cloud-only display placeholder). It is an internal state the user never sees separately. Dropped.
- 13 "Cloud selection reconciliation", "Pending migration preflight", "Corrupt checkpoints". These are internal or edge races. Dropped under the repo rule on unlikely races.
- 13 "Project composer" placeholders ("Message {agent}", "You're out of usage"). Project and billing surfaces are out of scope. Dropped.
- 13 "Claude-code continuation" placeholder. A Cursor-specific import path. Dropped.
- 10 "Branch selection busy", "checkout conflict", "Create Branch", "Unassociated branch warning". This is a Git workflow, not composer behaviour. It is kept as one line ("the branch chip is a real Git control"), and Nyte leaves it out.
- 10 "Environment Continue on / migration". Cursor-cloud migration. Left out.
- 10/13 MAX mode, "Add Models", catalog warning. Cursor-account specifics. Left out.
- 13 "Media limits", mention payload schema, MCP chip status. Demoted to unknowns, or dropped as transport detail.
- 03/13 queue "steer suggestion" banner cadence (two impressions, 14 days apart). Confirmed [code glass.js:596466–596485, 596600], but it is trivia. Folded into one sentence.
- 01 typing-bubble and planning rows. These belong to the transcript area, not the composer.
- 13 voice internals (250 ms hold threshold, waveform). Kept as one line, because Nyte leaves dictation out.

## Nyte-comparison fixes

| Draft row | Draft said | Nyte actually | Fixed call |
| --- | --- | --- | --- |
| 03 "Actual Esc-to-stop behavior" / 13 "Escape precedence" | Nyte's Esc only cancels an edit, or the frame was not inspected | Inside the editor, Esc runs in this order: suggestion menu, then cancel edit, then dismiss tray, then **stop the run** if one is busy. The stop button's tooltip says "Stop response (Esc)". | Keep. Nyte deliberately differs from Glass here; the spec records the difference. [packages/app/src/conversation/composer-frame.tsx:503–523, 583] |
| 03/13 "Queue send-now meaning" | Label at composer-queue.tsx:220 implies Send Now | The button is labelled "Add to next response" and it steers. The header hint says "Enter to steer" (:160), but the row's screen-reader description says "Enter sends now" (:85). Nyte contradicts itself. | Change wording only: use "Steer" everywhere. [composer-queue.tsx:85, 160, 220; composer.tsx:495–499] |
| 10/13 "Environment footer" | Absent, so drop | A "This Mac" environment menu exists on the new-chat screen, with an "Environments…" entry. | Keep it on new chat. Leave out a follow-up footer copy, because there is only one environment. [packages/app/src/screens/environment-menu.tsx:7–26; screens/workspace-context.tsx:146] |
| 10/13 "Git branch footer" | Absent | The branch shows read-only in the title bar for worktrees, on the new-chat context row and in the workbench rail. | Leave the composer footer out; the branch is already visible. [chrome/titlebar.tsx:65–70; screens/workspace-context.tsx:144–150; workbench/rail-status.tsx:160–176] |
| 13 "Child lock and preview routing" | No equivalent branch | A child session opened in a pane gets a full, editable composer. In the subagent tray's detail view, the child is shown without a composer, and the parent composer behaves as usual. | Keep the editable child. Adding the preview reference is optional. [screens/session-conversation.tsx:493–524] |
| Not covered by any draft | — | Drafts and attachments persist per chat with a 200 ms debounce. | Keep. [layout/session-view-state.ts:9, 189–251] |
| Not covered by any draft | — | Typing a printable key anywhere in the active pane focuses the composer. Paste is not routed this way. | Keep, and add paste routing. [screens/pane-host.tsx:27–54] |
| 01 "Explicit return to following" | Blurs, does not focus the composer | Confirmed. | Change: focus the composer after the jump, as Glass does. [conversation/transcript.tsx:755–757; Glass glass.js:684283] |
| 01 "Terminal anchor while expanded" | Nyte hides the chip while the tray is open | Confirmed. | Change, as 01 recommended. [conversation/tray/terminals.tsx:107] |
| 03 "Queue removal" | Failure stays on the row | True for queued rows. For unsent outbox rows the failure goes to the composer feedback line. | Keep. [composer.tsx:483–492, 569–578] |
| 10 "Model grouped right" | Nyte puts the model next to "+" | Confirmed. | Layout choice only. Keep it left. [composer-frame.tsx:573–577] |

## Runtime checks for a real Glass

Run each in Glass 3.28.5 with the settings left at their defaults unless a step says otherwise. Record what you see.

1. **Stop with a queue.** Start a long run and queue two messages. Click Stop. Record whether the first queued message starts by itself, both stay queued, or the queue clears.
2. **The faded message.** Reproduce the faded user message and inspect its element. Record whether it has the dimmed class, and whether an earlier message was being edited at the time.
3. **Esc with nothing to claim it.** In an idle chat with the side panel open, press Esc in the empty composer. Then repeat with the panel closed. Record whether the panel toggles.
4. **Composer shape.** Open an existing chat with the composer unfocused and empty. Record whether the composer is the one-row compact form or the two-row form, and measure its height. Then type 12 lines and measure again.
5. **Edges.** Measure the composer's left edge against the transcript text's left edge at the default chat width, and measure the gap from the composer to the window bottom.
6. **Dock chip.** Measure a terminal chip's height, corner radius and side padding, and the gap between two chips.
7. **Stop-and-send setting.** Set new messages to stop-and-send, start a run and type text. Record the send button's tooltip, then press Enter and record what happens.
8. **Ctrl+C on Windows.** Type in the prompt during a run with no text selected, press Ctrl+C, and record whether the run stops.
9. **Model picker focus.** Open the picker with the mouse and close it with Esc. Record where focus lands.
10. **Steer timing.** Steer a message mid-run. Record whether the agent's next tool call or text reflects it, and how long that takes.
11. **Queued tray reopen.** Queue a message, close the tray, then queue another. Record whether the tray reopens.
