# Sidebar audit

**Inputs**
- Worker reports: `workers/08-sidebar.md`, `workers/12-sidebar-deep.md`, and the sidebar-row parts of `workers/02-attention-outside-chat.md`.
- The user's addendum: hover actions, hover card, proportions.
- Glass bundle: `/tmp/glass/glass.js`. The `glass.min.js` sha256 prefix is `27cbde700afaa52a`, which matches the brief.
- Nyte source: `packages/app/src` at `5aabfa0cd` (equal to `origin/main`).

**Output:** `01-sidebar.md`.

**Method:** the audit is static. I opened every cited line for the state and action tables and the Nyte rows, and spot-checked the prose. I did not run Glass or Nyte.

## Summary

| Measure | Count |
| --- | --- |
| Claims checked against the cited line | 168 |
| Confirmed | 136 |
| Corrected (bundle facts, citations or Nyte calls) | 24 |
| Dropped as unsupported | 8 |
| Confirmed but cut from the spec: Cursor cloud, projects, automations, sharing, invites, migration, pin limit, error boundary, first-run trivia, label inventories | about 50 |

The counts are per table row or bullet, give or take 5.

**Overall confidence**
- **High** for grouping, ordering, folding, filters, the status icon order, pin and archive behaviour, keyboard handling and the hover card contents. These are direct code reads.
- **Medium** for anything the user perceives that depends on CSS: what the hover swap looks like, the row radius, which rows are indented.
- **Low** for which branches a real install shows. Feature flags and saved preferences decide that.

## Corrections

| Report | Claim | Finding | Evidence |
| --- | --- | --- | --- |
| 12 §9 | The file's hash does not match `27cbde…`, so provenance is unproven | Resolved. The minified `glass.min.js` matches `27cbde700afaa52a`. The formatted file differs only because it was reformatted. | `shasum -a 256 /tmp/glass/glass.min.js` |
| 02 §2, 08 §2, 12 §3 | Unread is set only on a successful finish ("done + unread") | Wrong. Unread is set when a run ends successfully or with an error while the chat is not displayed. It is not set when the user stops the run. A failed background chat shows the error dot with an emphasised, unread title. | [code glass.js:336099] [code glass.js:336122] [code glass.js:336097] [code glass.js:324959] |
| 08 §1 | Defaults enable "timestamps and environment metadata" | 12's clarification is correct. Age, environment icon and PR state are on. Environment text is "auto". Workspace, branch and source text are off. Rows are compact. | [code glass.js:467106] |
| 08 §1 | A chosen workspace is "made pending" | Clarified: it becomes the target for the next new chat. | [code glass.js:874330] [code glass.js:874388] |
| 12 §5 table | Cmd/Ctrl+Alt+N is at 882172 | 882172 registers only Cmd/Ctrl+N. The "preserve editor panel" variant is the next command in the same block. | [code glass.js:882172] |
| 12 §5 table | Previous and next chat live at 882352/882354, with the direct variants "distinct" | 882352 is Focus Next/Previous Tile. The real behaviour: Cmd/Ctrl+Alt+Up/Down moves a highlight and opens the highlighted chat when the modifier is released. Alt+Up/Down switches immediately, and going up past the first chat starts a new chat. | [code glass.js:882354] [code glass.js:873918] [code glass.js:873947] |
| 08 §1, 12 §3 | "Shortcut presentation" is mentioned but never specified | Missing behaviour: holding Cmd/Ctrl for 500 ms shows ⌘1–⌘9 badges on the first nine visible rows. | [code glass.js:858223] [code glass.js:858144] |
| 12 §2c, §4 | Archive is reversible with an Undo toast | Incomplete. (1) Archiving a running chat, or one with running subagents or background processes, needs a destructive confirmation, and the run stops. (2) If the archived chat was open, the next visible chat opens, or the one above it. (3) Drafts get no Undo. | [code glass.js:682104] [code glass.js:536638] [code glass.js:682014] [code glass.js:681906] [code glass.js:682120] |
| 08 §1 | Repository collapse keeps the selected chat visible (tagged inferred) | Confirmed and upgraded to code: the selected chat and any explicitly retained rows stay visible below the header. | [code glass.js:873452] |
| 08 §1 | Choosing Manual group order | Missing detail: choosing Manual freezes the order currently on screen. Dragging a header saves the order and switches to Manual. | [code glass.js:875815] [code glass.js:875809] |
| 08 §1 | Repository and Workspace groups are reorderable | Clarified: only the Repository, Workspace and Environment modes can be reordered. Time and Status keep a fixed order. | [code glass.js:466982] |
| 02 §2 | Unread completion is shown by the done/unread mapping only | Incomplete. The unread title emphasis applies to any unread chat that is neither a draft nor archived, so it also shows on error and attention rows. | [code glass.js:873103] |
| Addendum 1 | Pin seeds 266586, 297449, 297542; Archive seeds 266577, 267536 | Wrong seeds. 266577 and 266586 are protocol enum declarations, 297449 and 297542 are the slash-menu skill pin button, and 267536 maps composer headers. The real row hover buttons and menu items are elsewhere. | [code glass.js:873160] [code glass.js:872796] |
| Addendum 1 | The `--agent-sidebar-cell-hover-actions-width: 60px` token in glass.css sizes the row's hover slot | Wrong surface. That token belongs to the classic IDE agent-sidebar cell, a different UI layer in the same bundle. Glass chat rows reveal two 24 px action boxes 1 px apart, about 49 px in all. | [code glass.js:897918] [code glass.js:210515] [code glass.js:873160] |
| Addendum 2 | The hover card is the "chat-hover-tooltip" around 410866/410913/411955 | Wrong surface. That class is the classic text-hint tooltip with a 300 ms delay. The row card is the agent metadata preview card. Its rows are built at 469300–469489, its popup at 845497, and the sidebar places it right-start with a 4 px offset and a 100 ms close delay. The open delay defaults to 250 ms. | [code glass.js:845497] [code glass.js:876661] [code glass.js:180831] |
| Addendum 2 | "Local" seeds 298776, 299122, 299315 | Unrelated: 299122 is an MCP "Local" tag and 299315 is a customize-menu option list. The card's "Local" is the secondary text on its folder row. | [code glass.js:469302] |
| Addendum 2 | An "agent-hover-timestamp" element | Not in the bundle. The hover age is the row's hover timestamp slot. | [code glass.js:858054] [code glass.js:873160] |
| Addendum 2 | The card shows "interfaces-lab/nyte" with a branch icon | Partly right. The branch icon belongs to the repo line, whose text is `owner/repo` with the active branch name as secondary text. The folder line shows the path with home shortened to `~` and the secondary text "Local". | [code glass.js:469428] [code glass.js:469302] |

**Dropped as unsupported**

| Report | Claim | Reason |
| --- | --- | --- |
| 08 §1 | The account footer shows a plan description | The cited lines were not confirmed, and it does not matter to Nyte |
| 08 §1 | Automations availability comes from 876068 | Not confirmed, and out of scope |
| 12 §5 | Clicking the sidebar background clears the selection (875839) | Not confirmed. Multi-select is left out of Nyte anyway. |
| 12 §2c | A drag opens a hovered project section after one second | Not checked; projects are out of scope |
| 12 §4 | Unarchive removes named project-section membership | Not checked; out of scope |
| 12 §2f | Sidebar error-boundary fallback | Trivia a user rarely sees |
| 12 §2f | First run has no sample repositories | Restates the defaults |
| 08 §4 | "nyte" is an example row label | Padding |

## Nyte comparison fixes

| Report row | Was | Now | Evidence |
| --- | --- | --- | --- |
| 08 "Footer availability and settings state" | change: the gear name stays "Settings" while pressed | **keep.** A toggle should keep one name and expose its pressed state. Cursor swaps the name and also sets pressed, so screen readers announce the change twice. | `chrome/sidebar.tsx:569–577` |
| 08 and 12 "Extra / duplicate primary settings row" | drop | **keep.** The footer is hidden whenever the GitHub account query is loading or reports the service unavailable, so the primary row is the only entry that is always there. | `chrome/sidebar.tsx:560`, `chrome/github-account.ts:87` |
| 08 "No-repository home grouping" | change to an explicit no-repo label | **keep "Home".** It is the same concept, and Cursor's label alone is not a reason to rename it. 12 agrees. | `chrome/sidebar.tsx:344` |
| 12 "Failed versus waiting filter category" | change: split them | **keep.** The row description already distinguishes "Needs your answer" from the failure text. | `chrome/sidebar-rows.tsx:113–128, 298–302` |
| 08 "Repository-first default" | change to repository grouping and updated order | **keep** flat grouping and created order, but persist the user's choice. Rows stay put while agents finish. | `chrome/sidebar-view.ts:60` |
| 08 "Collection/filter/open-folder controls" | keep | **change.** The Show menu's Environment, PR, Branch and Machine toggles do nothing, because rows read only "Updated". PR lifecycle filters return no rows. | `chrome/sidebar-filter.tsx:203–217`, `chrome/sidebar.tsx:254`, `chrome/sidebar-view.ts:264–268` |
| 08 "Timestamp visibility" | "formatter outside these files" | The formatter is `components/ui.tsx:125`: "now" under a minute, then m, h and d, and a date after 7 days. Keep it. | `components/ui.tsx:125–140` |
| 12 "Current-chat placement hold" | `chrome/sidebar.tsx:197` | The hold is computed at `chrome/sidebar.tsx:206–220` and used only by the Inbox grouping (`chrome/sidebar-lists.tsx:224–226`). Line 197 is the blank-pane snapshot. | as cited |
| 02 "Manual sidebar read/unread action" | change: add both | **add "Mark as Read"** on rows and "Mark All as Read" on workspaces. "Mark as Unread" needs a new core operation, because unread is derived from a per-head read position. | `core/src/api/session.ts:658`, `core/src/fold/project.ts:117` |
| 12 "Pins" | keep pin-first sorting | **add** a Pinned section in grouped views. Pins inside a collapsed folder are hidden today. | `chrome/sidebar-view.ts:129, 138` |
| 08 "Automations navigation", 08 "Separate project collection" | change | **leave out.** These are Cursor-cloud surfaces with nothing behind them in Nyte. 12 agrees. | — |
| Not covered by any report | — | The hover pin and archive buttons are 16 px (`size="2xs"`). Change them to 24 px targets. | `chrome/sidebar-rows.tsx:314–330`, `ui/src/styles/tokens.stylex.ts:73` |
| Not covered by any report | — | Nyte already has a row hover card (title, `owner/repo` for the open workspace only, raw path). Extend it rather than build a new one. | `chrome/sidebar-rows.tsx:336–364` |
| Not covered by any report | — | Nyte uses Cmd+1–9 for window tabs, so leave out Cursor's Cmd+1–9 for sidebar rows. | `client-actions.ts:281` |
| Not covered by any report | — | Nyte archives a working chat without asking. Add a confirmation when archiving stops work. | `session-actions.ts:99` |
| Not covered by any report | — | The empty-workspace copy says "No sessions yet" where the rest of the UI says "chat". | `chrome/sidebar-lists.tsx:126` |

The 08 and 12 rows confirmed as written: New Chat row, Customize, nested workspace new chat, native folder picker, settings layer inert, account menu placement, created and updated sorting, workspace removal, rename and archive versus delete, and the loading and unavailable-cloud paths.

## Open questions only runtime can answer

Each is a check to run in a live Cursor Glass 3.28.5.

1. Hover a row with ages turned on. Does the age stay visible beside Pin and Archive, and how wide is the trailing slot?
2. Hover a "No Repo" chat. Does any card open? Time the card's open delay on an ordinary row (expected about 250 ms).
3. Let a background chat fail. Is its title emphasised as unread next to the error dot? Does opening it clear the emphasis but keep the error dot?
4. Archive the open chat. Does an Undo toast appear by default? Does the next chat below open? Does Undo reopen the archived one?
5. Archive a chat that is running. Read the confirmation copy and check whether the run stops.
6. Filter to a status that empties some groups. Which groups stay as folded "No agents matching filter" headers: only added workspaces, or every group?
7. Look at a read "Completed" chat. Is there a visible dot or an empty slot?
8. Double-click the sidebar resize handle. Does the width reset to 260?
9. Which new-chat label does the build show, "New Chat" or "New Agent", and is the Projects section present?
10. Hold Cmd for half a second with the sidebar visible. Do ⌘1–⌘9 badges replace the row ages?
