# Sidebar

Audited behaviour spec of the chat sidebar in Cursor Glass 3.28.5, restated in Nyte's terms, with a recommendation for each difference. The source is a static read of the shipped bundle: `/tmp/glass/glass.min.js` (sha256 prefix `27cbde700afaa52a`), formatted as `/tmp/glass/glass.js`. Nobody ran Glass. Rollout flags and saved preferences decide which branches a real install shows, so each line marked "runtime check" has to be confirmed in a live app before anyone builds against it.

Evidence tags: `[code glass.js:LINE]` means the line says it. `[inferred: …]` means it follows from code nearby but was not observed. Quoted labels are Cursor's UI strings, used only as evidence. Audit log: `audits/sidebar-audit.md`.

Out of scope, and left out of Nyte: Cursor cloud projects, automations, sharing and invites, "Open in Web", marketplace upsells and cloud-suggestion toasts.

## Purpose

The sidebar lists every chat you can return to, grouped so you can find one by where it ran, and it shows each chat's state (running, needs you, failed, finished and unread) without opening it. It is also where chats get triaged: you pin, archive, rename and filter them, and start a new chat in a chosen workspace. It never shows conversation content. Clicking a row opens that chat in the main area.

## Model

### Entities

- **Chat.** One conversation. It has a title, a status (draft, running, needs attention, error, done), an unread flag, a pinned flag, an archived flag, a last-updated time and a place: workspace folder, repository, worktree, remote host or cloud. Status, unread, pinned and archived are independent inputs, not a single enum. [inferred: glass.js:873009 reads them separately and 873160 combines their presentation]
- **Draft.** A chat that has not been sent yet. It is listed with its own muted treatment. [code glass.js:873103]
- **Group.** A folder or repository heading derived from the chats' places. It is not a conversation, and its header carries no status. When chats come from several clones of the same repository, Cursor groups them by git remote. A folder with no git remote keeps its own folder group. [code glass.js:468247]
- **Home group.** Chats started with no folder open go into one group that Cursor labels "No Repo" with a home icon. You cannot remove it from the sidebar. [code glass.js:468341] [code glass.js:873510]
- **Added workspace.** A folder you opened from the sidebar stays as a group even before it has any chats, and shows "No agents yet". [code glass.js:873630]
- **Pinned section.** A section labelled "Pinned" above the groups. A pinned chat moves out of its group and into this section. [code glass.js:864525] [code glass.js:864559]

### Grouping

- The modes are Repository (default), Workspace, Updated (time buckets), Status, Environment and Source. [code glass.js:873984] [code glass.js:467106]
- Updated buckets use local calendar days: "Today", "Yesterday", "Last 7 Days" (2–6 days), "Last 30 Days" (7–29 days) and "Older". [code glass.js:573778]
- Status groups appear in this fixed order: "Needs Attention", "Error", "Working", "Draft", "Done". An unread finished chat goes into Needs Attention, not into its own group. [code glass.js:863843] [code glass.js:863845]
- Under Status grouping, opening an unread chat keeps it in Needs Attention while it stays open, even though opening marks it read. It moves to Done once you leave it. [code glass.js:875956]

### Ordering

- **Chats.** By default the newest last update comes first, with ties broken by id. The alternative is Status order: attention, then error, then unread finished, running, draft and done, with recency inside each tier. [code glass.js:468300] [code glass.js:467106]
- **Last update, not creation.** The sort key is the last update. Archiving also counts as an update. Reading a chat does not. [code glass.js:912325] [code glass.js:912684]
- **Groups.** The default is Manual, saved separately for each grouping mode. Dragging a group header saves the order and switches to Manual. Switching to Manual freezes whatever order is on screen at that moment. A group seen for the first time goes to the top. "Updated" order sorts groups by their newest chat. [code glass.js:864545] [code glass.js:611592] [code glass.js:875805] [code glass.js:864465]
- **Fixed orders.** Only the Repository, Workspace and Environment modes can be reordered. Time and Status groups always keep their fixed order. [code glass.js:466982]

### How many rows show

- **Initial budget.** The first page of history depends on window height. Cursor takes the larger of 5 and half the number of 30 px rows that fit in the window height minus 160 px, gives those slots to the newest chats across all groups, then lets every non-empty group show at least 2. [code glass.js:864285]
- **Exceptions.** Today, Yesterday and the Needs Attention, Error and Working status groups show up to 100 rows straight away. The Pinned list starts at 5. [code glass.js:864302] [code glass.js:876579]
- **"More".** "More" reveals 8 rows at a time and scrolls them into view. If only one row would stay hidden, it is shown and "More" disappears. [code glass.js:873386] [code glass.js:242379]
- **Selected chat.** A selected chat past the fold raises the visible count to include it. When its group is collapsed, the selected row stays visible under the header while its siblings fold away. [code glass.js:872266] [code glass.js:873452]
- **Stale groups.** In Repository and Workspace modes, a group whose chats are all more than 7 days old starts folded once the local scan finishes. "7 days" is measured against the clock when the sidebar mounted, so a group never folds while you are looking at it. Expanding it yourself overrides the fold until the group goes stale again. [code glass.js:875629] [code glass.js:875737]

### Filters

- **Where they live.** Filters sit in the "Customize Sidebar" menu, next to Grouping, Ordering and Show. The menu offers Status, PR, Environment and Source, plus an "Archived" checkbox. "Reset" appears only when the filters differ from the default. [code glass.js:874263] [code glass.js:874286]
- **Archived.** "Archived" swaps the list for archived chats only. It does not add them to the live list. [code glass.js:863762]
- **Unread.** The "Unread" status filter also matches running and needs-attention chats. [code glass.js:863748]
- **Pins.** A pinned chat stays visible whatever the filters say. [code glass.js:863770]
- **Empty groups.** A group that ends up empty under a filter is folded by default. Opening it shows "No agents matching filter", which is a different message from the never-used "No agents yet". [code glass.js:874512] [code glass.js:873630]

### Persistence

| What | Scope | Evidence |
| --- | --- | --- |
| Grouping, chat order, group order, filters, Show fields, collapsed groups per mode, saved group order per mode | User setting, survives restart | [code glass.js:611912] [code glass.js:611950] |
| Pinned-section and collection collapse, expand times, rows revealed per group (last 100 groups) | Per machine | [code glass.js:875671] [code glass.js:875773] |
| Pins | Stored with the chat list | [inferred: glass.js:357462 names a pinned-chats store] |
| Sidebar width and visibility | Per user; hiding the sidebar automatically on a narrow window does not overwrite your choice | [code glass.js:884739] |

## Row anatomy

From left to right a row has a status icon in a fixed slot, the title (or a fallback name when the title is empty) and a trailing slot. The trailing slot shows the age by default, plus the PR and environment glyphs. You can turn on workspace, branch and source text from Show. [code glass.js:873160] [code glass.js:467106]

**Age.** The age measures time since the last update. It reads "1m" (never less) up to an hour, then "Nh", "Nd" up to 30 days, "Nmo" up to a year, then "Ny". It refreshes every minute. [code glass.js:291277] [code glass.js:376643]

**Hover and keyboard focus.** Hovering or keyboard-focusing a row reveals Pin and Archive buttons, or Restore on an archived row, in the trailing slot. The age stays readable: when ages are turned off it shows only on hover. [code glass.js:873160] [code glass.js:858069]

**Hidden buttons.** The hover buttons are left out of Tab order. Keyboard users reach the same actions through the context menu and shortcuts. [code glass.js:873160]

## Row states

| State | What the user sees | Enters on | Leaves on | Evidence |
| --- | --- | --- | --- | --- |
| Draft | Muted title, dashed draft dot, labelled "Draft" | Chat created, nothing sent | First send, or Discard | [code glass.js:291756] [code glass.js:873103] |
| Running | Animated dot grid, labelled "In progress". It stays on while background subagent work continues. | Run starts, or live subagent work exists | Work ends | [code glass.js:544806] [code glass.js:873009] |
| Needs attention | Attention dot, labelled "Needs attention" | An approval is waiting or a plan awaits review. This takes priority over running. | You answer and the status is recomputed | [code glass.js:357844] [code glass.js:544822] |
| Error | Error dot, labelled "Error". The title is unchanged. | Run fails | A new run starts. Reading the chat does not clear it. | [code glass.js:291745] [code glass.js:544824] |
| Done, unread | Unseen-completion dot, labelled "Completed, unread", with an emphasised title | A run ends, successfully or with an error, while the chat is not the one displayed | You open the chat or choose "Mark as Read" | [code glass.js:324959] [code glass.js:336099] [code glass.js:291747] |
| Done, read | Quiet seen-completion dot, labelled "Completed" | Unread clears | New run or "Mark as Unread" | [code glass.js:291748] [code glass.js:544828] |
| Unread with error or attention | Error or attention dot plus the emphasised title. Unread never replaces the status icon. | The run ended in error while the chat was not displayed | Open it | [code glass.js:291741] [code glass.js:873103] |
| Stopped by user | No unread flag | You stop the run | — | [code glass.js:336097] |
| Selected (current) | Active fill; it is the current page | You open the chat | Another chat or page opens | [code glass.js:873160] [code glass.js:211215] |
| Hover or keyboard focus | Pin and Archive (or Restore) buttons, age still visible | Pointer enters or keyboard focus arrives | Pointer or focus leaves | [code glass.js:873160] [code glass.js:858069] |
| Renaming | The title becomes a text field with its text selected | Double-click, or "Rename" in the menu | Enter or blur saves a trimmed, non-empty, changed name. Escape cancels. | [code glass.js:873160] [code glass.js:543997] |
| Pinned | The row sits in "Pinned". The pin button is filled and the menu says "Unpin". | Pin | Unpin | [code glass.js:864525] [code glass.js:872839] |
| Archived (only in the Archived view) | Archive icon, muted unless selected | Archive | Unarchive | [code glass.js:544807] [code glass.js:873103] |
| Group collapsed | Folder icon and name. Only the selected chat stays visible underneath. | Click the header or press Left | Click the header or press Right | [code glass.js:873452] [code glass.js:870403] |
| Group empty | "No agents yet", or "No agents matching filter" when a filter emptied it | No chats, or the filter excludes them all | A chat arrives or the filter changes | [code glass.js:873630] |

The status icon resolves in this order: archived, then draft, then running, then attention, then error, then done-unread, then done-read. [code glass.js:291756] [code glass.js:291741]

## Hover actions: pin and archive

**Pin** (hover button, menu "Pin" or "Unpin", or drag into Pinned):
- The chat leaves its group and appears in "Pinned" at the top. Pinned rows use the same chat order as everything else; you cannot drag them into a custom order. [code glass.js:864528]
- Dragging a pinned chat out onto a group or empty space unpins it. [code glass.js:870654]
- Unpinning puts the chat back in its group at its usual sorted position. Unpin is the undo, so pinning shows no toast. [inferred: unpin only removes the pinned id; glass.js:864525]

**Archive** (hover button, menu "Archive", or Cmd/Ctrl+Shift+E):
- If the chat is still working, or has running subagents or background processes, a destructive confirmation asks first. Cursor's wording is "Archive running agent?" / "Archiving will stop it and cancel the current task." Cancelling changes nothing. [code glass.js:682104] [code glass.js:536638]
- The chat leaves the list. If it was open, the next visible chat below it opens, or the one above when it was last. [code glass.js:682014] [code glass.js:681906]
- A toast offers Undo. Undo restores the chat, and reopens it if it was open. Drafts get "Discard" instead and no Undo. [code glass.js:682120] [code glass.js:541457]
- Archived chats live in the Archived view: Customize Sidebar → Filters → "Archived". There the hover button is Restore and the menu item is "Unarchive". A restored chat returns to its group. Archiving sets the last update to now, so the newest archives sort first. [code glass.js:863762] [code glass.js:875316] [code glass.js:912325]

## Hover card

- **Trigger.** Pointer hover on a chat row. The card does not open while the row is being renamed. [code glass.js:873176]
- **Delay and placement.** It opens after the hover-card default of 250 ms and closes 100 ms after the pointer leaves both the row and the card. It sits to the right of the row, top-aligned, 4 px away, with a maximum height of 400 px. The pointer can move into the card. Pressing the row does not close it. [code glass.js:876661] [code glass.js:180831] [code glass.js:845509] [code glass.js:873176]
- **Contents.** The full title comes first, then one line per fact, each with an icon. [code glass.js:469489]
- **No card.** If a chat has no facts to show, no card opens. [code glass.js:845502]
- **Copying.** A fact with a copy value (folder path, transcript path) is copied when clicked. Its copy icon turns into a check, and the tooltip reads "Click to copy". [code glass.js:469945]

| Chat kind | Lines after the title | Evidence |
| --- | --- | --- |
| Local folder in a git repository | Branch icon: `owner/repo`, with the active branch as secondary text. Folder icon: path with home shortened to `~`, with secondary text "Local". | [code glass.js:469428] [code glass.js:469302] |
| Local folder without git | Folder line only | [inferred: the repo line is skipped when no remote or path resolves; glass.js:469444] |
| Worktree | A fork-icon line: the worktree name, with secondary text "Worktree". It comes before the folder line. | [code glass.js:469314] |
| Remote (SSH, WSL, container) | Repo line, then a server-icon line with the host name, or "Remote" | [code glass.js:469367] |
| Cloud | Repo line, then a cloud-icon line "Cloud" with the environment name. Cursor adds a "Manage Environment" link; Nyte leaves it out. | [code glass.js:469387] [code glass.js:845490] |
| Draft | A pencil line, "Draft" | [code glass.js:469375] |
| Imported or automated | A source line such as "Imported from Claude Code" | [code glass.js:469483] |
| No folder (Home) | Probably no lines, so probably no card. Runtime check. | [inferred: an empty workspace has no path; glass.js:845502] |

## Actions

| Action | Result | Opens where | Evidence |
| --- | --- | --- | --- |
| Click a row, or Enter | Opens the chat and marks it read. Reading does not change the sort. | The current chat surface | [code glass.js:596239] [code glass.js:912684] |
| Alt-click a row | Places the chat next to the focused pane, on its left, marked read. With no split it falls back to a normal open. | Adjacent pane | [code glass.js:876398] |
| Cmd/Ctrl-click, Shift-click | Toggles or extends a multi-selection. It never opens the chat. | Sidebar only | [code glass.js:873019] [code glass.js:870354] |
| Right-click | Context menu "Agent actions" offering Pin/Unpin, Rename, Mark as Read/Unread, Fork, Move to, Copy, Open in New Window, Archive, Archive All Below and Unarchive, each shown only when it applies | Menu | [code glass.js:872796] [code glass.js:873175] |
| Double-click a row | Rename in place | In the row | [code glass.js:873160] |
| Hover Pin / Archive / Restore | See "Hover actions" above | Sidebar | [code glass.js:873160] |
| "Mark as Read" / "Mark as Unread" | Flips the unread flag without touching the run | Nothing opens | [code glass.js:873050] [code glass.js:872843] |
| Drop files on a row | Opens the chat with the files staged in its composer. Nothing is sent. | That chat | [code glass.js:875026] |
| Click a group header | Folds or unfolds the group and saves that per grouping mode | Sidebar | [code glass.js:875719] |
| Group "+" button | New chat targeting that group's folder or repository. Its label is "New Agent in <name>". | New-chat surface | [code glass.js:873467] [code glass.js:877903] |
| Group context menu ("Workspace actions") | "Open in IDE", "Edit Workspace", "Mark All as Read", "Archive All" and "Remove from Sidebar". Removing takes the folder off the sidebar and deletes nothing. The Home group cannot be removed. | Menu | [code glass.js:873663] [code glass.js:873674] [code glass.js:873510] |
| Drag a group header | Reorders groups and switches to Manual | Sidebar | [code glass.js:875805] |
| "Customize Sidebar" (list-filter button, Cmd/Ctrl+Alt+F) | Menu with Grouping, Ordering (Chats / Groups), Show, Filters, Archived, Reset and "Mark All as Read" | Anchored menu | [code glass.js:874000] [code glass.js:884118] |
| "Open Workspace" (folder-plus button) | Chooser listing recent folders plus open, clone and remote options. Picking a folder adds it to the sidebar, makes it the target for the next new chat and closes the chooser. Cancelling adds nothing. | Popover, then native picker | [code glass.js:874366] [code glass.js:874382] |
| Collection header (Repositories or Workspaces) | Folds the whole list and saves that per machine. Creating a chat reopens the list. | Sidebar | [code glass.js:875677] [code glass.js:875695] |
| Top "New Chat" | Starts an empty draft; New Chat shows as active until a chat is selected | Main area | [code glass.js:467091] [code glass.js:877799] |
| Footer gear | Toggles Settings. The chat list is hidden and inert, and the top action becomes "Back". | Settings replaces the list in the sidebar | [code glass.js:871761] [code glass.js:876078] [code glass.js:876499] |

## Keyboard and accessibility

**Structure**
- The sidebar is a navigation landmark. Rows are focusable buttons, and the open chat is marked as the current page. [code glass.js:540573] [code glass.js:211215]
- Group headers expose their expanded state and toggle on Enter or Space. Buttons inside a header do not fold it. [code glass.js:210853]
- Status icons carry spoken names, so state never depends on colour alone. [code glass.js:544802]

**Moving and acting**
- Up and Down move focus through visible rows, headers and controls. Home and End jump to the first and last. Moving focus never opens a chat. [code glass.js:870376]
- Right expands a folded header, or steps into its rows when it is already open. Left folds an open header, or moves focus from a chat up to its header. [code glass.js:870403]
- Enter opens the focused chat. Space toggles multi-selection. Escape clears multi-selection, except in a text field, where it cancels the rename. [code glass.js:870428] [code glass.js:870367]
- The selected row scrolls into view, to the nearest edge, when it is clipped. [code glass.js:873097]

**Default shortcuts** (users can rebind them)

| Shortcut | Action | Evidence |
| --- | --- | --- |
| Cmd/Ctrl+N | New chat | [code glass.js:882172] |
| Cmd/Ctrl+B | Hide or show the sidebar | [code glass.js:653904] [code glass.js:884339] |
| Cmd/Ctrl+Alt+F | "Customize Sidebar" | [code glass.js:884118] |
| Cmd/Ctrl+, | Settings | [code glass.js:883239] |
| Cmd/Ctrl+Shift+E | Archive the active chat or the selection | [code glass.js:882335] |
| Cmd/Ctrl+1…9 | Open the first nine visible chats in sidebar order | [code glass.js:884290] [code glass.js:858115] |
| Hold Cmd/Ctrl for 500 ms | Shows ⌘1–⌘9 badges in those rows' trailing slots | [code glass.js:858223] [code glass.js:858144] |
| Cmd/Ctrl+Alt+Up/Down | Moves a highlight through the rows, like an app switcher, and opens the highlighted chat when you release the modifier | [code glass.js:882354] [code glass.js:873918] |
| Alt+Up/Down | Switches chats immediately. Going up past the first chat starts a new chat. | [code glass.js:882356] [code glass.js:873947] |

## Proportions

The numbers below come from the Glass chat sidebar's stylesheet and constants. They are measurements to map onto Nyte's tokens (`packages/app/src/theme/tokens.stylex.ts`, `packages/ui/src/styles/tokens.stylex.ts`), not values to copy. Cursor builds them on a 4 px spacing step.

| Measure | Cursor | Nyte today | Recommendation |
| --- | --- | --- | --- |
| Sidebar width | Default 260, minimum 210, maximum 400 (also capped by the window and other panes). The value is stored per user. [code glass.js:481235] | Default 220, range 214–400 in 8 px steps (`preferences/index.ts:124`) | Raise the default to 256 so titles keep room beside a hover slot. Keep the range. |
| Hiding the sidebar | Fully hidden with Cmd/Ctrl+B. It hides itself on narrow windows or overlays the content, and has no icon rail. [code glass.js:884483] | Visibility saved, floating mode exists | Keep |
| Top bar | 40 px; 44 when the window chrome is resizable [code glass.css] | Title bar 35 | Keep Nyte's title bar |
| Row height | At least 28 px, with 5 px block padding [code glass.js:403260] | 28 (44 on touch) | Keep |
| Row side padding | 6 px [code glass.js:870203] | 4 | 6 (`--nyte-row-padding-inline-lg`) |
| Icon-to-title gap | 6 px | 6 | Keep |
| Gap between rows | 2 px [code glass.js:870203] | 1 | 2 |
| Status icon | 14 px glyph in a 20 px box | 14 in a 20 px slot | Keep |
| Hover buttons | 24 px boxes, 13 px icons, 1 px apart. The two buttons need about 49 px. [code glass.js:210515] | 16 px buttons (`size="2xs"`), 44 px trailing slot | 24 px buttons (the `--nyte-target-min` size) in a 52 px trailing slot |
| Indent of chats under a group header | None. The status icon lines up with the header's folder icon. Only Cursor project sub-rows indent, by 10 px. [inferred: glass.js:874771 is the only nested-rows user] | None | Keep |
| Space between groups | 16 px [code glass.js:870203] | 8 | 12–16 between workspace groups |
| Group label | 13/18 px text, at least 30 px tall, 9 px leading padding [code glass.js:870203] | Workspace headers are 28 px rows | Keep the 28 px rows, so all hit targets match |
| Row font | 13/18 px [code glass.js:398654] | 13 | Keep |
| Row corner radius | About 8 px [inferred: the sidebar row trigger uses the large radius token; glass.js:210515] | 8 | Keep |
| Hover card | Right of the row, top-aligned, 4 px gap, at most 400 px tall, opens after 250 ms, closes after 100 ms | Right, top-aligned, 4 px; tooltip default 300 ms | Open after 250 ms and allow pointer travel into the card |

## Nyte delta

Paths are relative to `packages/app/src`.

| Behaviour | Nyte today | Decision | Why |
| --- | --- | --- | --- |
| New Chat, Search, Customize at the top | chrome/sidebar.tsx:109, 401, 437 | keep | They already match. Customize is separate from the list's filter menu. |
| Automations, cloud projects, Share, Invite, Open in Web, cloud upsell toasts | absent | leave out | Cursor-cloud features with no Nyte surface behind them |
| Settings entry | Primary row chrome/sidebar.tsx:467; footer gear chrome/sidebar.tsx:569 | keep both | The footer is hidden whenever the GitHub account service is loading or unavailable (sidebar.tsx:560, chrome/github-account.ts:87), so the row is the only entry that is always there. |
| Gear's accessible name | Stays "Settings" with its pressed state (sidebar.tsx:572) | keep | A toggle should keep one name and expose its pressed state. Cursor swaps the name and also sets pressed, so screen readers hear the change twice. |
| Default grouping and order | Flat list sorted by creation (chrome/sidebar-view.ts:60) | keep | Rows stay put while agents finish, and status is shown in place. Updated order is one click away. |
| Saving view settings and folds | Component state that resets on reload (chrome/sidebar.tsx:171–179) | change | Persist grouping, sort, filters, Show fields, folded workspaces and revealed counts, the way Cursor does |
| Workspace group order | Alphabetical (chrome/sidebar.tsx:329) | change | Add drag-to-reorder with a saved order; a newly added workspace goes to the top. Offer "Updated" group order. |
| Updated buckets | Rolling "Past day / Past week / Earlier" (chrome/sidebar-view.ts:221) | change | Calendar buckets (Today, Yesterday, Last 7 Days, Last 30 Days, Older) match how people remember time |
| Status grouping | Separate Unread group; failed and waiting share Needs Attention (chrome/sidebar-view.ts:70, 201) | keep | The row's description already tells failure from waiting (chrome/sidebar-rows.tsx:113, 298) |
| Pins | Pinned chats sort first inside each list (chrome/sidebar-view.ts:129, 138) | add | A Pinned section above the workspaces in grouped views, with pinned chats leaving their folder. Pins in a collapsed folder are hidden today. |
| Archived filter | Shows archived chats alongside live ones (chrome/sidebar-view.ts:270) | change | Show archived chats only. That is where you go to restore one. |
| PR filters and Show fields | Any PR choice except "No PR" returns nothing (chrome/sidebar-view.ts:264); the Environment, PR, Branch and Machine toggles change nothing because rows only read "Updated" (chrome/sidebar-filter.tsx:203, chrome/sidebar.tsx:254) | change | Hide controls that do nothing until rows render that data |
| Selected chat past the fold or in a folded workspace | Hidden (chrome/sidebar-lists.tsx:339–341; the folded panel hides every row) | add | Keep the open chat's row visible; users lose their place without it |
| Stale workspaces start folded | absent | add | After persistence lands: fold workspaces whose chats are all more than 7 days old, measured at mount |
| Workspaces emptied by a filter | Expanded, with "No chats match these filters" (chrome/sidebar-lists.tsx:353) | change | Fold them while filtering and keep "Clear Filters" |
| Empty workspace copy | "No sessions yet" (chrome/sidebar-lists.tsx:126) | change | "No chats yet". The rest of the UI says "chat". |
| Paging | 5 rows, then 8 more, with a lone leftover shown (chrome/sidebar-lists.tsx:55–64) | keep | Already matches. Cursor's window-height budget is an optional refinement. |
| Status icons and the unread rule | Unread means a successful finish, shown with an eye icon; failure has its own lasting mark (chrome/status-glyph.tsx:15, session-read-state.ts:3) | keep | Cursor also flags failed runs as unread, but Nyte's failure mark already persists until the next run |
| Mark as Read / Unread | absent from the row menu (chrome/sidebar-rows.tsx:226–247) and from the workspace menu (chrome/sidebar-lists.tsx:400–418) | add | Add "Mark as Read" on rows and "Mark All as Read" on workspaces. "Mark as Unread" needs a core operation that moves the read position back. |
| Hover pin and archive | Present, but as 16 px buttons (chrome/sidebar-rows.tsx:314–330) | change | 24 px targets in a 52 px trailing slot; keep the age visible beside them |
| Hover card | Title, `owner/repo` only for the open workspace, raw path (chrome/sidebar-rows.tsx:336–364) | change | Add branch as secondary text, a `~` path, a machine label ("Local" or the host), worktree, remote and cloud lines and click-to-copy. Show the repo for every workspace and open after 250 ms. |
| Archiving a working chat | Archives straight away (session-actions.ts:99) | add | Confirm first when archiving will stop work |
| After archiving the open chat | The pane goes blank and Undo restores it there (layout/pane-controller.ts:275) | keep | Undo depends on the blank pane; jumping to the next chat would break it |
| Multi-select (Cmd/Shift-click, bulk actions) | Cmd/Ctrl-click and middle-click open in a background tab (chrome/sidebar-rows.tsx:41, 285) | leave out | Conflicts with Nyte's tab gestures; "Archive All Chats…" covers the bulk need |
| Alt-click to open beside | "Open Chat to the Side" in the menu (chrome/sidebar-rows.tsx:234) | keep | Same result, reachable from the keyboard |
| Arrow-key navigation | absent; Tab only | add | Up/Down/Home/End/Left/Right as specified above |
| Cmd+1–9 to open chats, hold-Cmd badges | Nyte uses Cmd+1–9 for window tabs (client-actions.ts:281) | leave out | Taken by the tab model |
| Cmd+Alt+Up/Down switcher | absent | leave out | Ctrl+Tab already cycles tabs; revisit after arrow navigation ships |
| Double-click to rename | Menu only (chrome/sidebar-rows.tsx:231) | add | Cheap, and expected in a list |
| Rename commit rules | Enter or blur saves a trimmed, changed name; Escape cancels (chrome/sidebar-rows.tsx:193–219) | keep | Matches |
| Drop files on a row | absent | leave out | Not needed for this release |
| Remove workspace, hide Home | chrome/sidebar.tsx:369–373 | keep | Removing never deletes anything, as in Cursor |
| "Archive All Chats…" confirmation | chrome/sidebar.tsx:598 | keep | Bulk and destructive enough to confirm |
| Open folder | Native picker straight away (chrome/open-workspace.tsx:187) | keep | Cursor's chooser adds clone and SSH, which Nyte handles elsewhere; keep the trust prompt |
| Settings layer | List made inert, focus moved across (chrome/sidebar-content.tsx:96–125) | keep | Matches |
| Row and slot sizes | See Proportions | change | Row side padding 6, row gap 2, hover slot 52, default width 256 |

## Acceptance journeys

Each journey is a Nyte desktop e2e test with an isolated `HOME` and `NYTE_HOME`.

1. **Unread, selection and persistence.** Open workspace W and send in chat A a prompt that runs about 10 seconds. Switch to chat B before it finishes.
   - When A finishes, its row shows the unread mark while B stays open.
   - Click A: the mark clears and A's position under "Updated" order does not change.
   - With A open, fold W: A's row stays visible under W's header and the other rows hide.
   - Set grouping to Status, then reload the app: grouping is still Status and W is still folded.
2. **Hover actions and hover card.** In a git-backed workspace on branch `main`, hover chat A's row.
   - Pin and Archive appear as 24 px buttons and the age stays visible.
   - After about 250 ms a card opens to the right with A's full title, an `owner/repo` line with secondary text `main`, and a `~/…` path line with secondary text "Local". Clicking the path line copies the full path.
   - Click Pin: A moves into a "Pinned" section above the workspaces and leaves W.
   - Unpin, then Archive: A disappears and a toast offers Undo. Undo brings A back in place.
   - Archive A again and turn on Filters → "Archived": only archived chats are listed.
3. **Keyboard.** Focus the first chat row.
   - Down moves focus and opens nothing; Enter opens the focused chat.
   - Left moves focus to the workspace header; Left again folds it; Right unfolds it.
   - End focuses the last visible control.
   - Double-click a row, type a new name and press Escape: the old title remains.
4. **Archiving a working chat.** Start a long run in chat C and click Archive on its row.
   - A confirmation dialog appears. Cancel, and C keeps running and stays listed.
   - Archive again and confirm: C leaves the list and its pane goes blank with Undo.

## Runtime checks still needed

Run these in a live Glass 3.28.5 before building the matching part:

1. On hover, does the age stay visible beside Pin and Archive, or is it hidden? Measure the trailing slot width.
2. Does the hover card open for a "No Repo" chat? Time its open delay in the sidebar (expected 250 ms).
3. Does a failed run in a background chat get the emphasised, unread title?
4. Does the Undo toast appear by default after an archive, and does Undo reopen the chat that was open?
5. Which groups stay visible under a filter: only workspaces you added, or every group?
6. Does a read "Completed" chat show a visible dot or an empty icon slot?
7. What gesture resets the sidebar width to 260: a double-click on the handle?
8. Which new-chat label ships: "New Chat" or "New Agent"?

One Nyte check: does archiving a working session stop it on the host? That decides the confirmation copy.
