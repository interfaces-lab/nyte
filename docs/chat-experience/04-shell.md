# 04 · The chat shell

Audited spec. Source behaviour: Cursor Glass 3.28.5, read statically from the shipped bundle. Evidence tags such as `[glass.js:846266]` point at the formatted bundle in `/tmp/glass/`, and quoted strings marked "Cursor:" are Cursor's own UI labels. Nyte paths are relative to `packages/app/src/` unless they say otherwise. The audit log is `audits/shell-audit.md`.

## Purpose

The shell is everything around the transcript: the tab strip, each tab's status and hover card, the right panel, the title-bar controls, and the signals that reach the user when the chat they care about isn't on screen. Its job is to let someone run several agents and their subagents at once without losing any of them, and to show at a glance which one wants attention. This spec gives the behaviour and proportions Nyte should build, where Nyte already matches, and where it should deliberately differ from Cursor.

## The one structural fact

Cursor has no window-level tab per chat. Choosing a chat in the sidebar swaps the whole view. The strip at the top of the chat pane belongs to that one root chat and holds **the root plus its own children** (subagents, side chats, and threads in a project) [glass.js:846222, 846430, 861629-861643]. Preview tabs exist only for children.

Nyte's strip is window-level: every tab holds a pane layout with any chat, a new chat, or a page (`tabs/model.ts:20-30`). This spec keeps Nyte's container and moves the useful Cursor behaviours into it:

- one replaceable **preview** slot per window
- child chats open next to their parent instead of replacing it
- status and hover cards on every tab
- chronological back/forward.

## 1. Tab model

### 1.1 Cursor's rules

**Preview vs permanent.**
- Opening a child that isn't already "durably open" defaults to a preview tab. Exceptions: the open forces a split, or the caller asks for permanence [glass.js:846238, 846258].
- A preview tab shows its title in italics whether or not it is selected [glass.js:401881, 523533].
- Each pane has at most one preview. Nothing in the visible tab says "preview": the accessible name is the title alone [glass.js:243650].

**Placement when something opens** [glass.js:523518-523521, 846266-846285]:
1. The chat already has a tab: reveal and activate it. This does not promote a preview.
2. Otherwise, if the pane already has a preview: close that preview and put the new preview **in the same slot**. The replaced preview is not recorded as "closed", so reopen won't bring it back [glass.js:846273-846276, 845941-845942].
3. Otherwise: append the preview and activate it.

**Promotion** keeps the tab, its position and its content, and drops the italics [glass.js:846287-846292]. Any of these promotes:
- Double-clicking the title. Double-clicking a *permanent* tab starts rename instead [glass.js:243644-243649, 861962-861970].
- Cursor: "Keep Open" in the tab's context menu, shown only on a preview [glass.js:861962].
- Submitting a follow-up from the preview's composer. Promotion happens at submit, before the reply arrives. Typing alone doesn't promote [glass.js:862116-862118, 562558].
- Dragging the tab to a new position, or moving it to another pane. Only a user move counts; programmatic moves don't [glass.js:845956-845962, 523524-523528].
- The chat becoming durably open some other way, for example being opened permanently elsewhere [glass.js:846037].

**Permanent opens:** "reopen last closed", picking an entry in the plus menu, creating a new thread, forced splits and drag-drop into a pane [glass.js:846173, 862053, 846372, 846309].

**Activation** marks the chat read. So does opening it (preview or permanent), cycling to it with the keyboard, and focusing its pane [glass.js:846242, 846262, 861966-861969, 846187, 846215]. Selecting a tab never changes its permanence.

**Close** [glass.js:243109-243121, 243609-243632]:
- Ways to close: close button, middle-click, the Delete key on a focused tab, the context-menu items Cursor: "Close" / "Close Others" / "Close to the Right" / "Close All", and Cmd/Ctrl+W on the active closable tab.
- Batch closes skip the root, which can't be closed.
- If the closed tab was active, the most recently active survivor takes over. Physical neighbours are the fallback.
- Closing a child tab never stops the child. For ordinary chats it only removes the child from the "open" set and remembers it for reopen [glass.js:845853, 845946-845948]. Project threads with no turns are discarded instead [glass.js:845950-845955].

**Reopen** (Cmd/Ctrl+Shift+T) [glass.js:846145-846176, 884002]:
- The list holds up to 20 closed chats. It skips chats that are archived or already open, and reopens as permanent.
- The chord is shared with the right panel's "Reopen Last Closed Tab". Whichever was closed most recently wins.

**Reorder.** Drag only; the keyboard can't reorder. The root of a project can't leave its pane [glass.js:243598, 846296-846303]. Drag start and drop are announced through a polite live region [glass.js:243595, 243772].

**Plus control** (ordinary chat) [glass.js:862001, 862025-862071]:
- Labelled Cursor: "Open Subagent". It opens a search picker (Cursor: "Search agents", "Agents", "No agents found") of this chat's children whose tabs aren't open. Picking one opens it permanently.
- If every child is already open, the plus control disappears.
- Creating a new thread from plus (Cursor: "New Agent") exists only for Cursor-cloud projects [glass.js:861779-861783]. Leave it out.

**Archiving or removing a child** closes its tab, and the child won't come back through reopen [glass.js:846022-846043, 846166-846169].

**Restart.** Only the root and durably open children are restored. Previews don't survive [glass.js:845849-845853, 845857-845859].

**Back/forward history** [glass.js:567775-567826, 847245-847252, 847308-847330]:
- The title bar's left group is: sidebar toggle, search, Cursor: "Go Back", Cursor: "Go Forward".
- They walk a chronological list of *destinations*, not tab positions. A destination records the root chat, the selected child, a previewed subagent, and the right panel's open state, active tab and previewed file. Settings and other app pages are destinations too.
- A visit identical to the current step is ignored. A new visit after going back discards the forward steps.
- The list keeps 50 entries.
- Each arrow is disabled when there's nowhere to go.
- Landing on a conversation step reopens the child even if its tab was closed [glass.js:847229].

**Root tab details.**
- An ordinary root shows an environment icon after its title: the machine kind, falling back to a laptop. It is information, not a control, and doesn't mark permanence [glass.js:547387-547390, 861937].
- The root's status icon is hidden while it is the only tab [glass.js:845853, 861958].

### 1.2 What Nyte should build

Nyte keeps window tabs and adds **one preview slot per window**.

| Rule | Behaviour |
|---|---|
| Preview sources | (a) Opening a child chat from its parent: citation link, subagent call row, report row, or tray "Open as full chat". (b) **Recommended:** a plain click on a chat in the sidebar. Without (b), every sidebar click adds a tab (`tabs/model.ts:247-254`). |
| Permanent sources | New chat; Cmd/Ctrl-click or middle-click "open in new tab"; reopen; splitting; dropping a chat into a pane; anything already permanent. |
| Placement | Already shown in a tab → activate, no promotion. A preview exists → replace that tab's content in place. No preview → insert right after the active tab; for a child opened from its parent, right after the parent's tab. Keep the blank-tab rule as it is: a blank new-chat tab takes the next foreground open (`tabs/model.ts:249`). A blank tab is never a preview. |
| Look | Italic title. Append ", preview" to the tab's accessible name. That improves on Cursor, which doesn't say it. |
| Promotion | Double-click the title (Nyte tabs have no rename, so there's no clash); a "Keep Open" item in the context menu; submitting a message in a pane of that tab (at submit); a drag that changes position; splitting the tab or dropping a second chat into it. |
| Replacement bookkeeping | A replaced preview is not added to the closed-tab list. |
| Close / reopen | Same as permanent tabs. Reopen restores the tab as permanent. |
| Restart | Don't restore preview tabs. |
| Back/forward | Add title-bar arrows and Cmd+[ / Cmd+] (Alt+← / Alt+→ on Windows/Linux). History is chronological and window-scoped: tab or pane focus changes and page visits. It ignores repeats, drops the forward branch on a new visit, and keeps 50 entries. It is separate from `recent`, which stays the close fallback. |

### 1.3 Tab state table (Nyte target)

| State | Entered by | User sees | Left by | Evidence (Cursor) |
|---|---|---|---|---|
| Permanent, inactive | Any permanent open; promotion | Upright title, status glyph, unread dot if a run finished unseen | Activate, close, drag | [glass.js:846222] |
| Permanent, active | Click, keyboard, open | Selected background; close button | Activate another; close | [glass.js:243584] |
| Preview | Preview source with no existing tab | Italic title in the single preview slot | Promotion, replacement, close | [glass.js:846266, 401881] |
| Preview replaced | Another preview source | The new chat in the same slot; the old chat leaves no reopen entry | (terminal) | [glass.js:846272-846276, 845942] |
| Blank new chat | New tab, or the last tab closed | "New chat" title; absorbs the next foreground open | Open or start a chat | Nyte `tabs/model.ts:159-166, 249` |
| Closed (restorable) | Any close | Gone; first in Cmd+Shift+T | Reopen (as permanent) | [glass.js:846170-846176] |
| Closed (gone) | Chat archived or deleted while closed or open | Tab removed; not reopenable | (terminal) | [glass.js:846022-846043, 846166] |

## 2. Subagent tabs

### 2.1 Entry points (Cursor)
- **Citation link** in the parent's reply. It opens a strip tab (preview by default). If no strip is attached and the child belongs to the active chat, it falls back to the in-chat agents tray. Otherwise it shows Cursor: "Chat not found" (local) or Cursor: "Subagent not found" (cloud) [glass.js:783428-783446, 881919-881940].
- **Agents tray row.** Depending on a host flag, the row either opens a tray preview or goes straight to a strip tab. From the tray preview, Cursor: "Expand full chat" opens the strip tab [glass.js:598381-598412, 598441-598450, 684157-684164].
- **Plus picker**, Cursor: "Open Subagent" (permanent) [glass.js:862052-862053].
- **Reopen last closed** (permanent) [glass.js:846173].
- **History landing** on a step that recorded the child [glass.js:847229].
- A child that is merely spawned does **not** open a tab: no automatic open path was found. Tabs are restored only for children already durably open [glass.js:846227-846231, 846387]. Confirm at runtime.

### 2.2 What the tab shows
- Title: the child's name, with fallback Cursor: "Subagent" [glass.js:846217-846219, 845853].
- Leading status glyph: same states as any chat, from the child's own status. A child that is still doing background work shows as running even if its stored status says done [glass.js:547330-547333, 547407-547421].
- The child's full conversation. The first user message is the delegated prompt [glass.js:353224-353226].
- Its own composer. Whether a child accepts follow-ups is covered by the input-routing spec.
- A hover card (section 3) built from the child's own metadata.

### 2.3 Lifecycle

| Event | What happens to the child tab | What happens to the parent | Evidence (Cursor) |
|---|---|---|---|
| Child spawned | No tab | The parent's tool row and tray count it as working | runtime check |
| Child opened | Preview tab next to the root, chat marked read | Unchanged | [glass.js:846261-846265] |
| Child running | Animated glyph, "In progress" | Tray pill "Working" with a count (in-chat) | [glass.js:544806, 597758-597765] |
| Child needs attention | Attention dot, "Needs attention" | Tray shows attention | [glass.js:544819-544822] |
| **Child finishes, tab active** | Glyph clears to "Completed". No unread, because it is the displayed chat. The tab stays open and keeps its preview or permanent state. | Foreground: the tool result carries the child's final reply and tool-call count. Background: a completion is queued for the parent's next turn (when long-running jobs are on). | [glass.js:324959-324962, 324907-324912; 278907; 352965-352967] |
| Child finishes, tab inactive | "Completed, unread" dot until activated | As above | [glass.js:291747-291748, 861966-861969] |
| Child fails | Error dot | Tool row: Cursor: "Couldn't start" or "Stopped with error"; an aborted child returns Cursor: "Subagent was aborted by the user" | [glass.js:544823-544824; 305980; 278907] |
| User closes a running child tab | Tab removed and added to reopen; **the child keeps running** | Unchanged | [glass.js:845946-845948] |
| User reopens | Same child, permanent, with the progress made meanwhile | Unchanged | [glass.js:846170-846176] |
| Child archived | Tab closes; not reopenable | Unchanged | [glass.js:846022-846043] |
| Parent finishes its turn | Child tabs unaffected | No completion notification while background children run | [glass.js:324946] |
| Parent stopped | Foreground children abort with it; background children have their own stop. **Runtime check.** | — | [glass.js:344887-344905] |

### 2.4 Relation to the parent
- The parent never waits on a tab. Results flow through the agent runtime, not the UI. Opening or closing a child tab changes nothing for either agent.
- Subagent turns never send system notifications. Only roots do [glass.js:324942].
- A pending approval inside a child is attributed to the parent when someone clicks the notification [glass.js:324923-324929, 765880].

### 2.5 Nyte target
- "Open as full chat" (`screens/session-conversation.tsx:510-513`) and child links should open a **preview window tab right after the parent's tab**. Today the child replaces the parent in the same pane, and with the window strip on nothing leads back: "Back to parent chat" exists only in the no-strip title bar (`chrome/titlebar.tsx:80-103, 196-203`).
- Without a strip (web), keep today's replace-plus-back-arrow behaviour.
- Child tabs follow every rule in section 1. Closing one never stops the child. Stopping stays in the tray's Stop Agent / Stop Agents (`conversation/tray/agents.tsx:102-109, 189-215`).
- A child that finishes while its tab is open leaves the tab alone: same slot, same preview state, glyph cleared, unread only if the tab is inactive.

## 3. Tab hover card

Cursor shows a metadata card when the pointer rests on a tab. **The same card body powers the sidebar row hover card** (shared component; the sidebar auditor owns that variant) [glass.js:845511-845523, 876661].

| Aspect | Behaviour | Evidence (Cursor) |
|---|---|---|
| Trigger | Pointer rests on a tab, or the tab gets keyboard focus (the trigger handles focus). Not while renaming or dragging. | [glass.js:243660 (hover trigger disabled when editing or dragging); 181136-181179] |
| Timing | Opens after 250 ms; closes 100 ms after the pointer leaves. Moving into the card keeps it open. | [glass.js:180831, 114086, 181018] |
| Position | Below the tab, centred, 8 px gap. (Sidebar variant: right of the row, start-aligned, 4 px gap.) | [glass.js:243772, 181018; 876661] |
| Size | Max 280 px wide, max 400 px tall, then scrolls; text wraps anywhere | [glass.js:845459, 845509; class resolves to max-width 280px] |
| Title | Full chat name, medium weight, small size. Left out if the chat has no name. | [glass.js:845463-845469, 469874-469877] |
| Rows | Each row has a 16 px icon column, an 8 px gap, a primary line and an optional quieter secondary line (2 px between them); rows are 6 px apart. | [glass.js:469958-469966, 469991] |
| Copy | Repo, branch and folder rows are buttons labelled Cursor: "Click to copy". They copy the full value and show a check for 2 s. A repo row copies its branch if present, otherwise the repo name. A folder row copies the full path even when it shows `~/…`. | [glass.js:469940-469956, 469839-469866, 469891-469893, 469995] |
| Accessible name | The card is named after the chat | [glass.js:845509] |

**Rows by chat kind**, in order [glass.js:469489-469491, 469405-469456, 469375-469396, 469300-469373]:

| Chat kind | Rows |
|---|---|
| Local chat in a git repo | Repo: branch icon, `owner/name` from the remote URL (or the folder name with no remote), secondary = current branch. Then folder: folder icon, path (`~/…` under home), secondary Cursor: "Local". |
| Local chat, no repo | Folder row only |
| Worktree chat | Repo row; worktree row (fork icon, worktree folder name, secondary Cursor: "Worktree"); folder row |
| Remote (SSH / WSL / container) | Repo row if known; remote row: server icon, host name, secondary Cursor: "SSH" / "WSL" / "Dev Container" / "Container" (just Cursor: "Remote" if the host is unknown) |
| Draft (not started) | Pencil, Cursor: "Draft" |
| Subagent | Built from the child's own metadata, so normally the same workspace rows as its parent. **Runtime check** for whether a child without tracked repos shows only the folder row. |
| Imported or automated | Adds a source row (Cursor: "Imported from Claude Code", Cursor: "Automation Run", …) |
| No rows and no title | No card |

**Nyte target.** Replace the current tab tooltip, which joins place titles with " | " and adds a ⌘1–9 hint (`tabs/window-tab-strip.tsx:122-153`), with this card. Build it as one component shared with the sidebar row card.
- Data source: session name, workspace path and worktree branch (already read by `chrome/titlebar.tsx:42-76`), the git remote and branch if the host exposes them, and the connection host for remote chats.
- For a split tab, show one block per pane, focused pane first.
- Move the ⌘1–9 hint into the card's footer.

## 4. Attention outside the open chat

| Event | Surface | Trigger | Shows | Count | Dismissed by | Expires | Evidence (Cursor) |
|---|---|---|---|---|---|---|---|
| Run in progress | Tab leading slot (and sidebar) | Status in progress, migrating, or live background work for that agent | Animated 3×3 dot grid; "In progress"; static under reduced motion | none | Status change | — | [glass.js:544802-544806, 189119, 547330] |
| Needs attention | Tab leading slot | Blocking decision pending | Dot, "Needs attention" | none | Decision resolved | — | [glass.js:291741-291744, 544819-544822] |
| Error | Tab leading slot | Run failed | Dot, "Error" | none | Next status | — | [glass.js:291745-291746] |
| Finished unseen | Tab leading slot | Run ended while the chat wasn't the displayed one | Dot, "Completed, unread" | none | Open, activate, cycle to, or focus its pane | — | [glass.js:324959-324962, 291747, 846069-846071] |
| Finished seen | Tab leading slot | Read flag cleared | Quiet dot, "Completed" | none | Next run | — | [glass.js:291748, 544827-544828] |
| Root finished, app unfocused | OS notification (silent) | Notifications on; app unfocused; a root turn completed with no queued messages, foreground tools, background subagents or goal continuation | Cursor: "Done • <chat name>" (or "Agent complete"); body Cursor: "Open Cursor to view the agent's output." | none | Click (opens the chat) or OS | OS | [glass.js:765811-765822, 324939-324948] |
| Root finished, app focused | — | Same, app focused | Nothing beyond the tab dot, even if another chat is on screen | — | — | — | [glass.js:765814] |
| Approval needed, app unfocused | OS notification (critical) | A run blocks on a decision | Cursor: "Approve terminal command" + Cursor: "Approval required to run: <command, max 140 chars>"; "Approve file edit" / "Approve N file edits"; "Approve file deletion"; "Approve MCP tool"; "Input needed • <question>"; buttons Cursor: "Accept" / "Reject" | none | Click (opens the parent chat), a button, or OS | OS | [glass.js:765824-765884] |
| Approval badge | App badge count | Same as above | One per chat waiting | Chats waiting | Viewing the chat | Auto-clears after 1 h unless the chat is in view | [glass.js:765786-765799, 765883]; Glass display unverified |
| Link target missing | Info toast | Child or chat can't be resolved | Cursor: "Chat not found" / "Subagent not found" | — | Close, timeout | 5 s default | [glass.js:783425-783441, 253926] |
| Generic toast | Bottom-right stack | Any app notification | Severity, text, actions, Cursor: "Close toast" | Up to 4 visible | Close, action, swipe | 5 s default; sticky ones don't expire; the timer pauses on hover, while expanded and while the window is hidden | [glass.js:253926, 253677, 253905] |
| Parallel local agents (cloud upsell) | Toast | ≥2 running top-level local agents in one repo, a 10 s delay, account eligibility, an experiment | Cursor: "Multiple local agents detected in this repo"; "Try Cloud" / "Later" | — | Action, close, swipe | 15 s | [glass.js:878801-878851, 868589, 879094] |
| Live change totals | Right rail "Changes" row | Working tree changes vs HEAD (staged + unstaged), refreshed live and not tied to run completion | `+N` (added colour) `−N` (removed colour); a zero side is omitted; hidden in the compact rail; no row when the chat has no folder | Lines added / removed | — | — | [glass.js:680075-680083, 681030, 681338, 561509] |

**Nyte target.**
- Keep the tab glyph plus unread dot (`tabs/use-window-tabs.tsx:153-186`) and the unread wording in the accessible name (`tabs/window-tab-strip.tsx:128`).
- Add OS notifications for root completion, failure and pending approval, only while the window is unfocused. Respect the existing but unconsumed `notifications` setting (`bridge.ts:14`). Clicking a notification focuses the window and opens the chat. Approval notifications open the chat; they carry no Approve/Deny buttons (see the delta table).
- Change the in-app "Run finished" toast (`packages/plugin/src/client/notifications.ts:16-27`) so it only appears for chats not visible in any pane. A visible chat already shows its result.
- Leave out the cloud toast.

## 5. Right panel and title-bar controls

### 5.1 Cursor layout
- **Title bar, left:** sidebar toggle, search, back, forward [glass.js:847308-847317].
- **Title bar, right:**
  - Cursor: "IDE" + ↗. This opens or focuses Cursor's separate editor window for the chat's workspace, with a generic fallback [glass.js:864906-864923, 942082-942112].
  - Share and members controls (cloud).
  - Cursor: "…", named "Chat actions" and scoped to the chat. It holds Split Down/Right, Pin, Rename, Mark as Read/Unread, Move to, Fork, Copy ▸ (Branch, PR Link, Transcript), Share, Open in New Window, and Archive / Discard / Leave Project. Each entry appears only when it applies. A disabled "…" holds the place while the chat loads [glass.js:866626-866638, 600448].
  - A Show Apps toggle, present only while the panel is hidden [glass.js:866609-866621].
- **Chat strip:** sits in the chat pane's top row at title-bar height [glass.js:574680, 862311-862319].
- **Panel hidden → launcher rail** on the right [glass.js:864694-864700, 681473]:
  - Open panel tabs first.
  - Then a heading Cursor: "On <workspace name>" (fallback "On workspace"). It is plain text, not a switcher.
  - Then the rows Cursor: "Changes" `+N −N`, "Browser", "Terminal" / "1 Terminal" / "N Terminals" (hover lists the terminals), "Files" [glass.js:681028-681034].
  - A chevron toggles labelled (260 px) and compact icon-only (40 px) modes. The rail goes compact on its own when its host area is narrower than 880 px [glass.js:681038, 680913].
- **Launchers reuse what exists** [glass.js:685533-685545, 686471, 685470-685606]:
  - Browser activates the last usable browser tab, otherwise the first real one, otherwise a placeholder, otherwise a new tab.
  - Terminal activates the most recent terminal in this workspace, or creates one.
  - Files restores the last open document, otherwise the file start page.
  - Changes opens the review tab.
- **Panel:** Cursor: "Hide Apps" sits in its header. Cmd+Opt+B (Ctrl+Alt+B) toggles it. Hiding never closes tabs [glass.js:884341, 884821, 850051].

### 5.2 Nyte target
- Keep the workbench rail headings, including "On <name>" with the "On This Mac" fallback (`workbench/workbench.tsx:278`). Keep the open-tab rows and the existing collapse controls.
- Change "Changes" to show signed line totals using the existing `ChangeStats` (`workbench/changes-toolbar.tsx:161`). Keep "No changes" when the tree is clean.
- Change the Browser launcher to reuse the last browser tab instead of deduplicating by URL (`workbench/controller.ts:475, 650`).
- Change the Terminal launcher to focus the most recent terminal. Today it always creates one (`workbench/workbench.tsx:153`). Show a count; listing terminals on hover is optional.
- Change the Files launcher to restore the last open document.
- Change the title-bar "…" (`chrome/titlebar.tsx:209-229`) into the chat's menu. Keep Split. Add Rename Chat… and Delete Chat…, moved from the pane menu at `screens/session-conversation.tsx:453-462`; Mark as Unread; Copy ▸ Transcript / Branch; Open in New Window if the desktop supports it.
- Leave out "IDE ↗" until Nyte has a real editor handoff.

## 6. Proportions

Cursor numbers are the default chrome. Cursor also ships a "resized" variant; its values are in brackets. Map each onto Nyte tokens (`packages/ui/src/styles/tokens.stylex.ts`, `packages/app/src/theme/tokens.stylex.ts`) rather than hard-coding.

| Measure | Cursor | Nyte today | Recommendation |
|---|---|---|---|
| Title bar / chrome row height | 40 px [44] | 35 px (`--nyte-titlebar-height`) | Keep 35 px. The density difference is within Nyte's theme. |
| Title-bar padding | start 12 px, end 10 px [8] | start max(traffic-light inset, 10 px), end 8–10 px | Keep |
| Title-bar control size / radius | 24 px / 6 px [28 / 8] | 28 px / 8 px (`--nyte-btn-height-md`) | Keep |
| Gap between title-bar controls | 1 px [6] | 4–8 px | Keep |
| Tab height | 26 px [32] | 28 px (button md) | Keep |
| Tab radius | 6 px [8] | 8 px | Keep |
| Gap between tabs | 1 px [2] | 2 px | Keep |
| Tab padding start / end | 5 / 6 px [10 / 10] | 10 / 6 px | Keep |
| Icon-to-title gap | 6 px | 6 px | Same |
| Tab title size | 13 px (base) | 12 px (sm) | Keep 12 px |
| Tab width | Sized to content, **max 280 px**, no min. Equal-width panel tabs: 120–140 px. | Flex basis 240 px, min 72 px | **Change** to content width with a 280 px cap and a 72 px floor. Short titles stop wasting space; long ones get room. |
| Title overflow | No ellipsis. Clipped, with a 24 px fade at the end when overflowing. While the close button shows, the fade runs from 42 px to 18 px before the end. | Ellipsis | Theme call. Keep ellipsis, or switch both strips to the fade together. Don't mix. |
| Close button | Hidden until the tab is hovered or focused; overlays the title end, 4 px from the edge | Reserved slot; shown on the active tab, otherwise on hover/focus | Keep Nyte's |
| Strip overflow | Scrolls; 8 px fade at whichever edge has more tabs | Scrolls, scrollbar hidden, no edge cue | **Add** the 8 px edge fade |
| Preview style | Italic title | — | Add (section 1.2) |
| Hover card | 250 ms open, 100 ms close, 8 px below, max 280 × 400 px | Tooltip | Add (section 3) |
| Right panel width | Default 50 % of the space left of it; min 384 px; no max; stored as a ratio | Default 400 px, min 300 px, stored in px | **Change** default to 50 % with a 384 px floor, stored as a ratio, so it scales with the window |
| Chat column minimum | 424 px; "narrow" layout below 448 px | 424 px (`WORKBENCH_CENTER_WIDTH_MIN`) | Same. Add a narrow mode below 448 px if the composer needs it. |
| Rail width labelled / compact | 260 / 40 px; compact below an 880 px host | 214 / 40 px; compact when collapsed or overlaid | Keep widths; add the automatic compact rule |
| Sidebar width | 260 px default, 210–400 resize | 220 px | Sidebar auditor |

## 7. Keyboard and accessibility

**Cursor tab strip** [glass.js:243609-243695, 243650]:
- A horizontal tablist named Cursor: "Chats" [glass.js:862004]. One tab stop.
- ←/→ move focus and wrap; Home/End go to the ends. Moving focus doesn't activate.
- Enter/Space activate. Delete closes a closable focused tab, and focus returns to the selected tab.
- Close buttons are named "Close <title>" and kept out of the Tab order.
- Middle-click closes.
- Drag is announced in a live region.
- The keyboard can't reorder.

**Cursor commands:**

| Action | Keys |
|---|---|
| Close chat tab | Cmd/Ctrl+W, active closable tab only [glass.js:884000] |
| Reopen chat tab | Cmd/Ctrl+Shift+T [glass.js:884002] |
| Next / previous tab | Cmd/Ctrl+Shift+] / [, plus Ctrl+] (macOS) or Alt+] (others), plus Cmd/Ctrl+Alt+] or →. These cycle chat tabs **only in projects**; otherwise they cycle right-panel tabs [glass.js:884245-884257, 883529-883538] |
| Back / forward | Cmd+[ / Cmd+] on macOS; Alt+← / Alt+→ on Windows and Linux [glass.js:847249] |
| Apps panel | Cmd+Opt+B / Ctrl+Alt+B [glass.js:884341] |
| Terminal | Cmd/Ctrl+J, Ctrl+` [glass.js:884354] |
| Notifications area | Alt+T focuses it; Escape collapses it [glass.js:253795] |

**Nyte today:**
- Cmd/Ctrl+T new tab, Cmd/Ctrl+W close, Cmd/Ctrl+Shift+T reopen (`client-actions.ts:46-66`).
- Cmd/Ctrl+1–9 and Ctrl+Tab / Cmd/Ctrl+Alt+←/→ cycle tabs (`client-actions.ts:278-297`).
- The tablist is named "Tabs" (`tabs/window-tab-strip.tsx:205`).

**Nyte target:**
- Keep the existing bindings.
- Add Cmd+[ / Cmd+] (Alt+← / Alt+→) for history; these are free in Nyte today.
- Add Delete to close the focused tab.
- Add ", preview" to the names of preview tabs.
- The hover card must open on keyboard focus as well as hover, and closes on Escape.
- Keep close buttons out of the Tab order, and return focus to the selected tab after a close.

## 8. Nyte delta

| Behaviour | Nyte today | Decision | Why |
|---|---|---|---|
| Window-level tabs holding pane layouts | `tabs/model.ts:20-30` | keep | Fits Nyte. Cursor's per-root strip would hide sibling chats. |
| Reuse the existing tab for an open chat | `tabs/model.ts:235-241` | keep | Matches Cursor's "reveal existing" |
| One preview slot per window (italic, replace in place) | absent | add | Stops tab pile-up; gives child chats a place |
| Sidebar plain click opens the preview | `tabs/model.ts:247-254` (always a new tab) | change | Without it, every browse adds a tab. Recommended, not required for parity. |
| Promote on double-click, Keep Open, submit, drag, split | absent | add | Cursor's full rule set; double-click is free in Nyte |
| Child "Open as full chat" / child links | `screens/session-conversation.tsx:510-513` replaces the parent | change | Open a preview tab after the parent; the parent stays one click away |
| Back to parent | `chrome/titlebar.tsx:80-103` (no-strip mode only) | keep, and fine without a strip | The strip variant gets the parent tab instead |
| Close keeps the child running | `conversation/tray/agents.tsx:135-143` (tray close) | keep | Viewing and running stay separate |
| Close fallback to the most recent tab | `tabs/model.ts:283-293` | keep | Same as Cursor |
| Reopen closed tab | `tabs/model.ts:355-367`, 25 entries | keep; skip deleted or archived chats | Cursor skips archived; a reopen of a gone chat is a dead tab |
| Replaced preview not reopenable | absent | add | Avoids flooding reopen with drive-by opens |
| Drop previews on restart | absent | add | Previews are transient |
| Back/forward history | absent (`chrome/titlebar.tsx:191-301`) | add | Chronological navigation is separate from tab order |
| Environment suffix icon on the root | absent | leave out | The hover card carries environment; one place is enough |
| Tab status glyph + unread dot | `tabs/use-window-tabs.tsx:153-186` | keep | Already maps to Cursor's states |
| Distinct failed vs completed in the tray | `conversation/agent-status.ts:13-15` | change | Failed shows as "Completed" today |
| Tab hover card (title, repo/branch, folder, worktree, remote; click to copy) | tooltip of joined titles, `tabs/window-tab-strip.tsx:122-153` | change | The most-asked "which chat is this?" signal; share it with the sidebar card |
| Plus control | New tab (`chrome/titlebar.tsx:120`) | keep | Cursor's picker solves a per-root strip problem Nyte doesn't have |
| "Close All" in the context menu | absent (`tabs/window-tab-strip.tsx:167-189`) | leave out | Close Others covers it; the last tab can't close anyway |
| Delete key closes the focused tab | absent | add | Cheap keyboard parity |
| OS notification: root finished or failed, window unfocused | absent (no desktop code; `bridge.ts:14` unused) | add | The main way to pull a user back |
| OS notification: approval needed, window unfocused | absent | add, without Approve/Deny buttons | Approving a command from a banner without context is a security call; ask before adding |
| App badge for waiting approvals | `bridge.ts:15` unused | add, behind the existing `unreadBadge` setting | A cheap glanceable count |
| In-app "Run finished" toast | `packages/plugin/src/client/notifications.ts:16-27` (always) | change: only for chats not visible in any pane | Cursor relies on tab dots; a toast for the chat you're watching is noise |
| Cloud "Multiple local agents" toast | absent | leave out | Cursor-cloud upsell |
| Changes `+N −N` in the rail | file count, `workbench/rail-status.tsx:180-196` | change | Line totals show the size of the work at a glance |
| Browser / Terminal / Files launchers reuse | create or deduplicate by URL, `workbench/workbench.tsx:147-153` | change | Launchers should return to what you had |
| Automatic compact rail below 880 px | collapse is manual or overlay (`workbench/workbench.tsx:517`) | add | Keeps the chat column usable |
| Right panel default 50 %, min 384 px, stored as a ratio | 400 / 300 px (`workbench/controller.ts:13-15`) | change | Scales with the window |
| Title-bar "…" holds chat actions | split only, `chrome/titlebar.tsx:209-229` | change | One place for chat-scoped actions |
| "IDE ↗" | absent | leave out | No editor handoff in Nyte yet |
| Tab width: content-sized, 280 px cap | 240 px basis, 72 px min | change | Proportion match without a theme change |
| Strip edge fade | absent | add | Shows there are more tabs |

## 9. Acceptance journeys (desktop e2e)

Run with an isolated `HOME` and `NYTE_HOME`. Use bench models.

1. **Preview tab promotion.**
   - Click chat A in the sidebar. A tab appears with an italic title, and its accessible name ends ", preview".
   - Click chat B. The same tab now shows B in the same position, the tab count is unchanged, and Cmd+Shift+T does not bring A back.
   - Double-click B's title. The italics go.
   - Click chat C. A new italic tab appears after the active tab, and B stays.
   - Type in C's composer without sending; C stays italic. Send; C turns upright at once, before any reply.
   - Open D as a preview and drag it one place left. D turns upright.

2. **Subagent finishes while its tab is open.**
   - In chat P, ask for one delegated task long enough to watch. Click the child citation in P's reply.
   - An italic tab K opens right of P's tab, showing the child conversation with the delegated prompt first and K's glyph running.
   - Keep K active until the child finishes. K's glyph stops, no unread dot appears, K stays italic and in place, and P's tool row shows the child's result.
   - Repeat with P active while the child finishes. K shows the unread dot, and activating K clears it.

3. **Closing a running child.**
   - Open a running child as above, then close its tab. The child keeps working: P's agents tray still shows it as working.
   - Press Cmd+Shift+T. K returns as a permanent tab showing the progress made meanwhile.
   - Delete the child chat. K closes, and Cmd+Shift+T doesn't offer it.

4. **Attention outside the window.**
   - Start a root run, then focus another app. When it finishes, exactly one OS notification appears, titled with the chat name. Clicking it focuses Nyte on that chat.
   - Repeat with Nyte focused and the chat visible. No OS notification and no in-app toast appear.
   - Repeat with Nyte focused and the chat in a background tab. That tab shows the unread dot; no OS notification appears.
   - Trigger an approval while Nyte is unfocused. A notification names the pending action.

5. **Hover card and right panel.**
   - Hover a tab for a git-repo chat. After about 250 ms a card below it shows the full title, an `owner/repo` row with the branch, and a folder row (`~/…`).
   - Click the folder row. The full path is on the clipboard and a check shows for about 2 s.
   - Tab to the strip with the keyboard. The card opens on focus and Escape closes it.
   - With the workbench hidden, start a run that edits files. The rail's Changes row shows `+N −N` updating before the run ends.
   - Click Browser, navigate, hide the workbench, then click Browser again. The same page returns.

## 10. Runtime checks still needed

These can't be settled from the bundle. Each is phrased as a check to run against Cursor 3.28.5 (details in `audits/shell-audit.md`):

1. Whether the agents tray opens a preview or goes straight to a tab by default.
2. Whether a spawned child ever opens a tab without the user asking.
3. What Cmd+W does on the root tab: nothing, or Cursor's "Close this window?" confirm.
4. Whether Next/Previous Tab really skips an ordinary chat's subagent tabs.
5. Hover-card rows for a subagent tab, and whether the folder shows as `~/…` or in full.
6. What happens to foreground and background children when the parent is stopped.
7. Whether Glass shows an app badge for waiting approvals.
8. That a preview tab stays italic after its child finishes, and loses italics on drag.
