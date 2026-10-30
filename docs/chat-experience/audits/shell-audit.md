# Shell audit: tabs, subagent tabs, attention outside the chat, right panel

Scope: worker reports 04-tab-model.md, 05-subagent-tabs.md, 02-attention-outside-chat.md (tab, toast and notification parts only), 09-right-panel.md, plus the user's addendum (tab hover card, proportions).
Sources: Cursor Glass 3.28.5 formatted bundle `/tmp/glass/glass.js` (minified sha256 prefix 27cbde700afaa52a), `/tmp/glass/nls.messages.json`, `/tmp/glass/glass.css`; Nyte `origin/main` at `5aabfa0cd` in the chat-experience worktree.
Method: read windows around cited lines and followed call sites until the behaviour was settled. Nothing was run: Cursor was not launched, no server was started.

## Summary

| Report | Claims checked | Confirmed | Corrected | Unsupported or dropped |
|---|---|---|---|---|
| 04 tab model | 40 (every state and attention row, 18 of 24 routing rows, all keyboard lines, all Nyte rows) | 28 | 8 | 4 |
| 05 subagent tabs | 31 (every state and attention row checked against code or marked; routing rows sampled) | 19 | 7 | 5 |
| 02 attention outside (shell parts) | 24 | 17 | 4 | 3 |
| 09 right panel | 25 | 19 | 4 | 2 |
| Addendum seeds | 5 | 0 | 3 | 2 |
| **Total** | **125** | **83** | **26** | **16** |

Confidence:
- High: preview vs permanent tabs, promotion, replacement, close, reopen, history and the tab hover card. Each was traced to the code that decides it.
- Medium: subagent lifecycle once the child or parent ends. The code paths exist, but which feature flags are on in a shipped install is unknown.
- Medium: right-panel launcher reuse and sizing.
- Low: anything that depends on the OS or on experiments (notification delivery, cloud toasts, the "resized chrome" variant).

### The correction that matters most

All four reports, and especially 04's Nyte delta, treat Cursor's strip as a window-level tab strip. It isn't one. **Glass's strip belongs to one root chat: the root plus that chat's own children (subagents, side chats, project threads).** Picking a chat in the sidebar swaps out the whole strip, so there is never a tab per sidebar chat. Preview tabs exist only for children. Nyte's strip works differently: it is window-level, and each tab holds a pane layout of any chats or pages (`packages/app/src/tabs/model.ts:20-30`). The spec therefore says where preview semantics should go in Nyte's model. It does not copy Cursor's container.

Evidence: one tab manager per root agent, with the root kept non-closable [glass.js:846222]. Instances are cached per root [glass.js:846430]. The strip is created only for the displayed conversation's parent [glass.js:861629, 861643]. Default permanence is temporary for any child not already durably open [glass.js:846258].

## Corrections

| Report | Claim | Finding | Evidence |
|---|---|---|---|
| 04 | "Preview child … selected child title is italic" | **Corrected.** A preview title is italic whether or not the tab is selected. The style is keyed only on the preview attribute. Row 3 of the same report gets this right, so row 2 contradicts it. | [glass.js:401881; 523533] |
| 04 | Plus menu offers "New Agent" in "eligible project contexts" | **Corrected.** The create item appears only when the root is a cloud project agent you own whose target is a new, non-private cloud environment. The plus button's label still reads "New Agent" whenever the profile can create threads, even with no create item. Ordinary chats get "Open Subagent", a search-only picker of children whose tabs aren't open. If there's nothing to create and nothing unopened, the plus button disappears. | [glass.js:861779-861783; 862025-862056] |
| 04 | Double-click on a preview promotes it | **Confirmed, but incomplete.** On a permanent tab, double-click starts rename. A preview tab has no rename handler, so the same double-click promotes it. A builder must implement both meanings. | [glass.js:243644-243649; 861962-861970] |
| 04 | "Cmd+Shift+[ and ] registered on macOS; cycling wraps when the project strip owns the action" | **Corrected.** "Next/Previous Tab" is bound on every platform to Ctrl/Cmd+Shift+] and [, Ctrl+] / Ctrl+[ on macOS, Alt+] / Alt+[ elsewhere, and Ctrl/Cmd+Alt+] or →. It cycles chat tabs **only when the root is a project agent**. For an ordinary chat with subagent tabs, the same keys cycle the right panel's tabs. No key cycles an ordinary chat's subagent tabs. | [glass.js:883529-883538; 883847; 884245-884257; 846446] |
| 04 | Cmd/Ctrl+Shift+T "can reopen the last restorable closed chat" | **Refined.** The chord is shared with the right panel's "Reopen Last Closed Tab". Chat reopen wins only when the newest closed chat is newer than the newest closed panel tab. The list keeps 20 entries. It skips archived chats and chats already open, and it always reopens as permanent. | [glass.js:846145-846176; 845933 (limit 20); 884002; 884022] |
| 04 | Close of a project child "requests discarding if empty" | **Scoped.** Only project threads are discarded when empty. For ordinary chats, closing a child tab only removes it from the "open" set and remembers it for reopen. | [glass.js:845942-845955; 845853] |
| 04 | Root chat row: protected | **Refined.** The root can't be closed and can't be dragged to another pane. In ordinary chats the root's status icon is hidden while it is the only tab. The laptop or environment icon shows only on an ordinary root, never on a project root or a child. | [glass.js:846222; 845936; 846296-846303; 845853; 861958; 861937; 547387] |
| 04 | Nyte delta: add preview state to window tabs as Cursor does | **Reframed.** Cursor has no window-level preview. The spec recommends one preview slot per Nyte window for child chats, and optionally for sidebar opens. That is a Nyte design choice, labelled as such, not parity. | see "Correction that matters most" |
| 05 | Child "in an editor-panel tab" is a normal expansion route | **Corrected.** The right-panel route only applies when there is no conversation-pane host and the panel is fullscreen in tab layout. The normal route is a child tab in the chat strip. | [glass.js:684155-684168] |
| 05 | "Side Chat Is Still Running" dialog guards closing a running child | **Scoped.** The dialog guards right-panel side-chat tabs only. Closing a child tab in the chat strip never prompts and never stops the child. | [glass.js:685142-685146; 845941-845955] |
| 05 | "Opening a permanent conversation marks it read" | **Corrected.** Every open marks the chat read: temporary, permanent, tab click, keyboard cycling and pane focus. | [glass.js:846242; 846262; 861966-861969; 846187; 846215] |
| 05 | "Subagent not found" shown when a child can't be opened | **Corrected.** That text is for cloud links. A local child that can't be found shows "Chat not found". | [glass.js:783425-783441] |
| 05 | Inline link opens "a conversation pane or tray preview" | **Refined.** The link first tries a child tab in the strip (preview by default). Only if no strip is attached and the child belongs to the active chat does it fall back to the in-chat agents tray preview. Otherwise it shows the not-found message. | [glass.js:881924-881940; 846459-846461] |
| 05 | "Parent finished, background child still working → parent shows child-running marker" | **Unsupported for tabs.** The cited line is the sidebar's custom-identity overlay. On tabs, a running indicator follows the tab's own agent having live background work, not the parent's. | [glass.js:291762-291768 (sidebar); 547330, 547417-547421 (tabs)] |
| 05 | Subagent tray mode (preview vs direct-open) | **Flagged.** Both modes exist and a host flag picks one. The shipped default isn't visible statically. | [glass.js:598318; 598381-598412; 684169] |
| 02 | System notification on completion "when completion guard passes" | **Made concrete.** The guard is: notifications on; app not focused; the turn completed; it is not a subagent turn; the chat isn't archived; no queued messages; no foreground tools running; no background subagents running; no goal continuation. Subagents never trigger a completion banner, and a parent's banner waits for its background children. | [glass.js:765811-765822; 324939-324948] |
| 02 | Pending-approval notifications "out of scope" | **Added.** When the app is unfocused and a run blocks on a decision, Glass sends a critical OS notification. Titles: "Approve terminal command" with "Approval required to run: <cmd ≤140 chars>", "Approve file edit" / "Approve N file edits", "Approve file deletion", "Approve MCP tool", "Input needed • <question>". It carries Accept and Reject buttons. Clicking it opens the parent when the decision belongs to a subagent. | [glass.js:765824-765884; 324923-324929] |
| 02 | Changes totals "available to the text rail" | **Refined.** Totals are measured against HEAD, staged plus unstaged, for the whole working tree, not per agent. They are hidden in the compact rail. The Changes row is omitted when the chat has no folder or workspace file behind it. | [glass.js:681338; 681441-681460 (vaE call); 561509; 17443-17445] |
| 02 | Nyte: "completion delivery cannot be classified as absent" | **Corrected (Nyte).** Nyte shows an in-app toast ("Run finished" / "Run failed: …") for every root run that ends, whether or not the chat is visible. No OS notification code exists in `packages/desktop/src`. The `notifications` and `unreadBadge` host-setting fields have no consumer. | `packages/plugin/src/client/notifications.ts:16-27`; `packages/app/src/client-plugins.tsx:33-39`; `packages/app/src/bridge.ts:14-15` |
| 09 | Rail inventory: Changes, Browser, Terminal, Files | **Incomplete.** The rail also lists side chats, open panel tabs, "Environment" (when a setup tab is available), pull requests (one row each, or grouped past a threshold), "Desktop" and "Machine Metrics". The last three are Cursor-cloud features. | [glass.js:681028-681034] |
| 09 | Compact rail under 880 px | **Confirmed, with widths added.** The labelled rail is 260 px wide and the compact rail 40 px. | [glass.js:681038 (880, 40, 260)] |
| 09 | Right-panel sizing not covered | **Added.** The panel defaults to half the space left after the sidebar, with a 384 px minimum and no maximum, stored as a ratio. The chat keeps at least 424 px and is "narrow" below 448 px. When space runs out, the sidebar becomes an overlay and then hides; after that the panel can hide. | [glass.js:481235; 884545; 884489-884511] |
| 09 | Nyte: chat menu "only offers splitting" | **Refined (Nyte).** The title-bar "…" only splits (`titlebar.tsx:209-229`), but Rename Chat… and Delete Chat… exist in the pane menu (`screens/session-conversation.tsx:453-462`). | Nyte files |
| Addendum | Hover-card seeds glass.js 410866, 410913, 411955 | **Wrong seeds.** Those lines are the classic composer's generic button tooltip (CSS class "chat-hover-tooltip", 300 ms). The tab hover card is the agent metadata card. | [glass.js:410863-410870 vs 845511-845523, 243660, 243772] |
| Addendum | `--agent-tab-fade-width: 4px` | **Wrong surface.** That variable masks the edges of the classic IDE's auxiliary-bar agent-mode composite bar, not Glass's chat strip. Glass uses an 8 px edge mask when the strip scrolls, a 24 px fade on an overflowing title, and a 42→18 px end fade while the close button shows. | glass.css (auxiliary-bar agent-mode rule); [glass.js:243283 tab variables; 210458; 401496] |
| Addendum | Folder path shown as `/Users/workgyver/...` | **Flagged.** The card shortens paths under the home folder to `~/…` when the home path is known, and copies the full path either way. The user saw a full path, so either the home path wasn't resolved or this was another surface. Needs a runtime check. | [glass.js:469297-469302; 258884-258889] |

## Unsupported or dropped (not carried into the spec)

- 05 states for parent stop/fail with detached children. The code shows separate abort handling [glass.js:344887-344905], but the user-visible outcome is runtime-only. Moved to runtime checks.
- 05 "Recent" retention, Stop All and Clear All in the agents tray. These live inside the chat, not the shell; left to the in-chat attention audit.
- 05 and 02 cloud paths ("Cloud agent complete", deep links, "Open in Web"). These depend on Cursor's account and cloud.
- 02 "Parallel local agents" and "Multiple worktrees" toasts. Verified [glass.js:878802-878851; 868589; 879094] and listed in the attention table as Cursor behaviour, but they upsell Cursor Cloud. Left out of Nyte.
- 02 sidebar rows, timestamps and Mark as Read/Unread. These belong to the sidebar auditor.
- 04 acceptance step about the laptop suffix "compared with a different environment". Speculative; the spec only says the suffix is an environment icon.
- 04 "keyboard-only reordering not established". True but padding; the spec says plainly that Cursor has none.
- 09 perf-vote dot and other developer-only title-bar controls [glass.js:866603]. Internal.
- 09 browser/terminal/file shortcut edge cases (a shortcut while the tab is already active). These are panel internals; reduced to one line.
- Hover-card "Ongoing voice call" and "Manage Environment ↗" rows. Cursor-cloud features.
- Any race-handling (stale open requests, detached activation queues, instance eviction). Per the repo rule, these need the user's buy-in before they add complexity, and none is needed for the base behaviour.

## Nyte comparison fixes

| Report row | Was | Is | Evidence |
|---|---|---|---|
| 04 "Laptop suffix: absent" | absent | No suffix, but the no-strip title bar shows a folder / worktree-branch crumb | `chrome/titlebar.tsx:42-76` |
| 04 "Plus opens or reuses a new-chat tab" | confirmed | confirmed | `chrome/titlebar.tsx:120`; `tabs/model.ts:218-227` |
| 04 "Close selects a recent survivor" | confirmed | confirmed; reopen keeps 25 tabs | `tabs/model.ts:257-297, 73` |
| 04 / 05 "Expand child via pane" | change | "Open as full chat" **replaces the parent in the same pane**. With the window strip on, no back-to-parent control exists: "Back to parent chat" renders only in the no-strip title bar. | `screens/session-conversation.tsx:510-513`; `layout/pane-context.tsx:109-111`; `chrome/titlebar.tsx:80-103, 196-203` |
| 05 "Dedicated child-tab lifecycle absent; verify pane layer" | unverified | Absent app-wide: no tab kind or flag marks a child chat; a child is an ordinary session place | `tabs/model.ts:20-30`; `layout/pane-controller.ts:166-176` |
| 05 "Distinct failed/stopped outcomes" | change | Confirmed: failed and idle both map to "inactive", labelled "Completed" | `conversation/agent-status.ts:6-17`; `conversation/tray/agents.tsx:25-29` |
| 02 "Window-tab activity / unread" | keep | Confirmed: a status dot only when not idle, an unread dot only on inactive tabs, unread in the accessible name | `tabs/use-window-tabs.tsx:153-186`; `tabs/window-tab-strip.tsx:128, 140` |
| 02 "Completion notification boundary" | unknown | In-app toast only, no OS notification (see corrections) | see above |
| 09 Nyte rows | as written | All confirmed at the cited lines (`workbench.tsx:147-153, 237-243, 278`; `rail-status.tsx:180-196`; `controller.ts:462-475, 650`) | Nyte files |
| (new) Tab tooltip | not covered | Nyte's tab tooltip shows the titles of the tab's places joined by " \| " plus a ⌘1–9 hint; no repo or folder | `tabs/window-tab-strip.tsx:122-153`; `tabs/use-window-tabs.tsx:177` |
| (new) Sizes | not covered | Title bar 35 px; tab 28 px tall, radius 8, slot flex basis 240 px, min 72 px; ellipsis truncation; close button shown on the active tab; workbench default 400 px, min 300 px, chat min 424 px; rail 214 px, icon rail 40 px | `theme/tokens.stylex.ts:7, 64-73`; `tabs/window-tab-strip.stylex.ts`; `workbench/controller.ts:13-17` |

## Runtime-only questions, phrased as checks

1. In an ordinary chat with two subagents, click the first subagent link in the parent's reply. Check that an italic tab opens right of the root. Then click the second link and check that it replaces the first tab in the same slot.
2. In the agents tray, select a child row. Note whether a tray preview opens or a strip tab opens directly; this records the shipped default.
3. With the root tab active in an ordinary chat, press Cmd+W. Check for no effect versus a "Close this window?" dialog.
4. With an ordinary chat holding root + two subagent tabs, press Cmd+Shift+]. Check that the right panel's tabs cycle, not the chat tabs.
5. Hover a root tab and a subagent tab for 250 ms. Record the rows each card shows, and whether the folder path appears as `~/…` or in full.
6. Let a subagent finish while its preview tab is active. Check that the tab stays italic, the progress icon clears, and no unread dot appears. Repeat with the tab in the background and check for "Completed, unread".
7. Archive a subagent whose tab is open. Check that the tab closes and is not offered by Cmd+Shift+T.
8. With the app unfocused, let a root run finish, then a subagent run. Check for exactly one banner, for the root. Then trigger a terminal-command approval while unfocused and check the banner text and its Accept/Reject buttons.
9. With the app focused on another chat, let a run finish. Check that no OS banner and no in-app toast appear; only the tab or sidebar dot.
10. Check whether the dock or taskbar shows a badge for pending approvals in Glass. The code updates a badge count and refreshes a tray menu, but it isn't clear whether that count shows in Glass.
11. Stop a parent while a foreground child runs, then repeat with a background child. Record whether each child stops.
12. Drag a preview tab to a new position. Check that it loses italics and that the next preview opens in a new slot.
