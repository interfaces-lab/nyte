# Transcript

Audited spec for the conversation transcript: how it is built, moves, marks what's new, and summarises work. Source: Cursor Glass 3.28.5, read statically. The audit log is `audits/transcript-audit.md`. Evidence tags point to `/tmp/glass/glass.js` lines. Nyte paths are relative to `packages/`.

Sections 1–9 are library-neutral rules. They hold whichever list engine renders them. §13 is a separate engine recommendation, and the spec stands without it.

## Purpose

The transcript shows a conversation as a column of rows that stay readable while an agent writes into it. It follows the end while you watch, holds still while you read, and tells you exactly where new messages start. Its summaries compress agent work into one line per run, and that line can still be opened to the full detail.

## Terms

- **Row**: one presentation unit in the column, such as a prompt, a reply, a tool line, a group header or a divider. A row is not a message or a turn.
- **Viewport**: the visible part of the column. Its **top edge** sits below any top inset. The **end** is the furthest scroll position.
- **Distance from end**: content height − viewport height − scroll offset.
- **Anchor**: a row identity plus the distance from the viewport's top edge to that row's top.
- **Follow state**: either *following* (the view keeps itself at the end) or *reading* (the view keeps an anchor still).
- **Read mark**: the persisted time, or position, up to which the user has seen this chat.

---

## 1. Rows

### 1.1 Kinds

Every row has a kind, a stable key and an estimate. Glass's estimates are listed to show proportion. Nyte keeps its own estimates scaled to its font (§10).

| Kind | What it shows | Key | Glass estimate |
|---|---|---|---|
| Prompt | A user message | `prompt:<message>` | 52 px (+64 with a reply quote) |
| Reply | Assistant prose | `response:<first message>` | 60 px while streaming. Once settled: the larger of 60 px and its last known height |
| Activity | One tool call or one thought, shown alone | `<message>` | 29 px tool, 36 px thought |
| Activity group | A run of adjacent tools and thoughts under one summary line (§6) | `step:<first member>` | One line, 24 px |
| Work group | A finished turn's work, folded under "Worked for …" (§6.5) | `work:<turn>` | One line |
| Notification / status / host row | System lines, retries, failures, cards | `<kind>:<id>` | 24–36 px |
| Time boundary | A timestamp line where more than 1 hour passed between messages, plus one at the start of the chat | `time:<following row>` | 28 px |
| Unread divider | The "New" line (§5) | `unread-divider:<first unread message>` | 28 px |
| Turn actions | The reply's actions row (§7.3) | `turn-actions:<turn prompt row>` | 36 px |
| End spacer | Fixed space below the last row, keeping it clear of the composer | `end` | Fixed, never measured |

[glass.js:191603–191715, 192167–192171, 192344, 209817–209850, 208081, 208450, 451964, 266500]

### 1.2 Identity rules

1. A row's key comes from the source message it starts with, never from its index. Keys survive streaming, regrouping, history prepends and reloads.
2. Growing a group by adding members does not change the group's key.
3. Expanding a group can add child rows. Their keys come from their own messages, so expanding changes the row count without changing any existing key.
4. The divider and the turn actions are keyed by the message they belong to. A time boundary is keyed by the row after it and is never used as an anchor. [glass.js:472772]
5. A row records which messages it shows, so a message ID can be resolved to its row (needed by §3.4 and §5).

### 1.3 Gaps

- Rows are separated by one default gap. Glass uses 14 px between every row.
- Consecutive user messages join with a 4 px gap, and the joined bubbles share their inner corners.
- The row before a mid-turn ("steer") message gets a 28 px gap.
- §9 gives Nyte's mapping. [glass.js:191433, 472376, 472678–472690]

---

## 2. Heights

### 2.1 Before a row is measured

A row's height comes from the first of these that exists:

1. Its committed (measured) height.
2. Its saved height from the height cache (§2.3).
3. A computed height, for plain-text prompts only (§13).
4. Its kind estimate.

Heights are whole pixels, at least 1 px. The end spacer's height is fixed and can be 0. [glass.js:472772]

### 2.2 Measuring

- A change of 2 px or less is ignored.
- A **settled** row accepts its first measurement as a correction. After that it ignores further size changes until the row gets a new revision. Revisions come from new content, media finishing loading, or a disclosure toggle.
- A **streaming** row only grows. Shrink measurements are ignored until it settles. This stops a streaming reply from jittering the rows below it. [glass.js:463059–463075, 463124, 477487]

### 2.3 Height cache

- Key: chat, row key, row revision, expansion state, and a **layout key**. The layout key is made of the content width rounded to 1 px, the device pixel ratio, the font family, size, line height and letter spacing, the density setting, and the surface.
- A saved height is used only when every part of the key matches. Any change in width, font or density invalidates it.
- Never record rows that are being edited or rows of the reply being generated.
- Don't record while fonts are still loading.
- Memory limits: 32 chats, 1,000 heights and 200 fold states per chat. The least recently used is evicted first.
- Optional disk layer, as in Glass:
  - Saves on orderly shutdown, writing only the rows that were last on screen plus the rows seen when the chat first opened.
  - Writes at most 16 chats per save and keeps 64 on disk.
  - Skips a chat that is unchanged and was saved within the last hour.
  - Reads a chat's record when the chat's data loads.

[glass.js:478294–478300, 478345–478470, 490939–490970, 771153, 771529–771533]

---

## 3. Scrolling

### 3.1 Thresholds

| Threshold | Value | Used for |
|---|---|---|
| Follow tolerance | 4 px from the end | Rejoining following. "At the end" for follow logic |
| UI "near the end" | 50 px in Glass (Nyte 60 px) | Hiding the scroll-to-bottom button. Clearing the down pill |
| Saved-position "at end" | 2 px | Saving the position as "end" instead of an anchor |
| Reader-input window | 250 ms | Attributing a scroll movement to the reader |
| Sticky-prompt edge | 2 px | Deciding when a prompt reaches the top edge |
| History lead | 2 viewport heights in Glass (Nyte keeps 3) | Starting to load earlier messages |

[glass.js:191433, 324352–324358, 463683, 462838–462860, 337605]

### 3.2 Following

1. **Enter following** on any of these:
   - The chat opens at the end.
   - The user sends a message.
   - The user uses scroll-to-bottom or the down pill.
   - The reader scrolls down to within 4 px of the end.
   - Content shrinks while the view was at the end.
   - The view sits within 4 px of the end with no reader input in the last 250 ms and no navigation in flight.
   - Content becomes shorter than the viewport.
2. **While following**, every layout change puts the view at the end in the same frame.
   - When the change is streamed growth no taller than one viewport, the view may glide there smoothly. Every other correction is instant.
   - While the pointer is down, or the reader scrolled upward within the last 250 ms, follow corrections wait. [glass.js:463346–463360]
3. **Release to reading** on either of these:
   - An upward movement attributed to the reader, meaning the pointer is down or there was input within 250 ms in the same direction. This releases even if the view is within 4 px of the end. The one exception: the movement only happened because the scrollable range shrank while the view was at the end.
   - An upward movement not attributed to the reader, if it leaves the view more than 4 px from the end.

   Downward movement never releases. [glass.js:462851–462858]
4. **Nyte's existing reading triggers stay:** expanding or collapsing anything, starting an edit, and selecting text (Nyte `app/src/conversation/transcript.md` rules 5–8).

### 3.3 Anchoring while reading

1. **Taking the anchor.**
   - A held control or selection is the anchor itself.
   - Otherwise, the anchor is the topmost row that crosses the viewport's top edge, with its offset from that edge.
2. **Compensation.** When rows above the anchor change height or are inserted (on first measurement, collapse, re-measurement or a history prepend), the scroll offset moves by the same amount, so the anchor stays still on screen.
3. **Growth below the anchor** never moves the view.
4. **Streaming still compensates.** While a reply streams above the reading position, a change in the anchor's own top is still corrected.
5. **Anchor removed.** If the anchor row disappears, re-anchor to the nearest surviving row at its current position. Never jump.
6. **Corrections during a gesture wait.** Above-fold corrections that arrive during an active reader gesture are held until input has been quiet for 250 ms, then applied. Exception: corrections while streaming or following are applied at once. [glass.js:463366, 464666–464734]
7. **Disclosures.** Before a disclosure changes a row's height, take the anchor first, so the clicked control stays put and the row grows downward. [glass.js:477539, 477578]
8. Browser scroll anchoring is off. The app is the only thing that writes scroll offsets. [glass.js:477607]

### 3.4 History loading

- Load one page of earlier messages when the view's offset from the top is less than the history lead (§3.1). Repeat until the view leaves that range or the first message is shown.
- Never load while the chat is opening, or while a load is already in flight.
- New rows go in above the anchor, and §3.3 rule 2 keeps the visible content still. The anchor is a row identity, never a raw offset. [glass.js:503951–503956, 368186]

### 3.5 Saved and restored position

1. **On leaving a chat** (switching chat, tab or pane, or unmounting), save once:
   - **End**: if following, or within 2 px of the end.
   - Otherwise an **anchor**: the anchor row's key, its first message ID, and the offset.
2. **Storage.** In memory, per chat per pane. Glass and Nyte both lose positions on restart; heights survive (§2.3). Nyte keeps 64 chats' view state (`app/src/layout/session-view-state.ts:11`).
3. **Restore.** Find the saved row by key, falling back to the first message ID.
   - Found: place it at the saved offset and enter reading.
   - Not found: open following the end. Never open part-way down an estimate.
4. **Reveal.** Hide the column until the rows in view have measured, or 2.5 s have passed, whichever comes first, so the user never sees the restore settle. [glass.js:477134–477139, 477167, 477112, 477223–477282]

---

## 4. Pinned prompt

1. A prompt is a candidate if it is a user prompt, including a steer message, that is not hidden and not a system notification.
2. **Which prompt pins.** At each frame, the active prompt is the most recent candidate whose top has reached the viewport's top edge plus 2 px.
   - If that prompt is as tall as the viewport or taller, no prompt pins. Don't fall back to an earlier one. [glass.js:463637–463650]
3. The pinned prompt stays at the top edge while its turn scrolls beneath it. The next prompt pushes it off when it arrives. Implement this by bounding the prompt's sticky region from its own top to the next candidate's top, or to the end. No duplicate overlay. [glass.js:463721–463728, 477639]
4. The active prompt is always rendered, even when it is outside the normal render window. [glass.js:463719]
5. A long prompt shows 3.5 lines, ending in a fade.
   - Clicking an editable prompt opens the editor.
   - A non-editable prompt expands while it is selected and collapses when focus leaves.
   - Text selection and link clicks inside a prompt never trigger those actions. [glass.js:485397, 479724, 479901, 485456]
6. While pinned, the prompt gets its active surface (background and small shadow) so text doesn't show through it. Its sticky region keeps 4 px below it.
7. Surfaces that show several senders side by side don't pin prompts.

---

## 5. Unread model

The unread model has two separate signals, and they must not be merged:

- **Down pill "↓ N New Messages ×"**: messages that arrived *below you while you are away from the end*. It's a temporary count for this visit.
- **Divider "New" with the up pill "↑ N New Messages ×"**: where unread replies *start*, based on the persisted read mark.

### 5.1 Which messages count

- **A message**: a user or assistant message that has visible text or sent content, and that is not display-only, suppressed, or a background-task completion notice.
- **An unread anchor**: an *assistant* message that is a message (as defined above) and whose start time is after the read mark. Your own prompts are never unread. [glass.js:679094–679112, 679136]
- **An incoming message** (for the down pill): an assistant message, or a system-generated user message, that is a message. Never your own prompts.
- Counts are of message identities. A message that keeps streaming counts once. An assistant message that started before you left the end, but got its first text after, counts. One that already had text does not. [glass.js:679105–679110]

### 5.2 Read mark

1. The read mark is persisted per chat. Glass stores a time, locally and on the server for cloud chats. Nyte stores a seen commit per head.
2. **Advance it to the latest message** whenever the chat is shown, the window is visible and focused, and nothing covers the transcript. Scroll position does not matter. Reaching the end is not required.
3. While the window is unfocused or hidden, the mark does not move. That is why the sidebar shows the chat as unread. [glass.js:679404–679406, 498744; Nyte `app/src/screens/session-conversation.tsx:250–296`]

### 5.3 Divider boundary (per visit)

The divider uses a **boundary**, separate from the read mark. The boundary is in one of two states: *fixed at time T* or *following*.

1. **On opening a chat**, the boundary is fixed at the read mark as stored *before* this visit advanced it.
2. **The divider** goes before the first unread anchor after a fixed boundary. With no read mark there is no divider.
3. **Fixed → following.** When no unread anchor is after the boundary and the window is active, the boundary follows the latest message. New replies that arrive while you are focused in the chat never get a divider. The down pill covers them if you are scrolled up.
4. **Following → fixed.** When the window loses focus or visibility, the boundary freezes at the latest message seen. Replies that arrive while you are away get a divider before the first of them, and it shows when you come back.
5. **What does not clear the divider:**
   - Scrolling to the end.
   - Crossing or seeing the divider.
   - Pressing × on the down pill.
   - Clicking the up pill.

   The divider stays until the up pill's ×, or until you leave the chat. On the next visit, the boundary starts from the read mark that §5.2 has already advanced, so the divider is gone.
6. The boundary, the pill acknowledgement and the down-pill cursor are visit state, never persisted. After a restart, the divider is rebuilt only from a read mark that was never advanced, which happens when replies arrived while the window was unfocused. [glass.js:679398–679402, 679446–679449]

### 5.4 Divider row

- Inserted immediately before the row containing the first unread anchor.
  - If that row is inside an expanded group, the divider goes inside the group, before the member.
  - If the group is collapsed, the divider goes before the whole group. [glass.js:192337–192348]
- Shows a 1 px rule, a small "New" label in the accent colour, and a 1 px rule. Screen readers hear "New messages below".
- Not interactive. It is never an anchor target for saved position, but it is the jump target for the up pill.

### 5.5 Down pill "↓ N New Messages"

1. **Shown when**:
   - The unread model is enabled for this surface.
   - The view is more than 50 px from the end (Nyte: 60 px) and not following.
   - At least one incoming message arrived after the *arrival cursor*.
2. **The arrival cursor** is the latest message at the moment the view left the end. Leaving the end captures it. Reaching the end, or following again, clears it.
3. **Count**: incoming messages after the cursor.
   - Label: "1 New Message", or "N New Messages".
   - Above 30 the label reads "30+ New Messages", but the stored count is unchanged.
4. **Click**: go to the end and follow (§3.2). The divider is not touched.
5. **×**: move the cursor to the latest message. The pill disappears, nothing scrolls, and the scroll-to-bottom button stays. The next incoming message starts a new count from 1. [glass.js:679450–679466, 683921–683943]

### 5.6 Up pill "↑ N New Messages"

1. **Shown when** a divider exists, its top is above the viewport's top edge, and this divider hasn't been acknowledged. The usual case: you open a chat at the end and unread replies start above.
2. **Count**: unread anchors from the divider onward, including the first.
3. **Click**:
   - Acknowledges the divider, so the pill goes.
   - Jumps instantly to the divider, placed one third of the way down the viewport.
   - Enters reading with the divider row as the anchor. [glass.js:679437–679443, 463329]
4. **×**:
   - Advances the read mark to the latest message and marks the chat read.
   - Fixes the boundary at that point. With nothing newer, the divider is removed.
   - Nothing scrolls. [glass.js:679446–679449]
5. **Acknowledged without a click** when the divider enters the viewport, or moves from above the viewport into or below it. Acknowledging hides the up pill. It never removes the divider. [glass.js:679411–679430]
6. **Acknowledged by new arrivals**: if a down count appears while this divider exists, the up pill for this divider is acknowledged for good.

### 5.7 Priority and controls

- Only one pill shows at a time. The down pill wins over the up pill. [glass.js:679471]
- **Position**: the pill floats near the top of the transcript, centred on the column, for both directions (§9).
- **Controls**:
  - The pill's body and its × are separate controls.
  - × is out of the tab order.
  - Backspace or Delete on the focused pill dismisses it.
  - Name the close control "Dismiss new messages", not "Remove …". [glass.js:209254–209285]
- **The plain scroll-to-bottom arrow is separate.**
  - It shows whenever the view overflows and is more than 50 px (Nyte 60 px) from the end.
  - It carries no count.
  - It sends the view to the end and focuses the composer. [glass.js:684280–684283]

### 5.8 What persists

| State | Lives | Survives chat switch | Survives restart |
|---|---|---|---|
| Read mark | Store (Nyte: seen commit) | yes | yes |
| Divider boundary | Visit | no; rebuilt from the read mark | no |
| Up-pill acknowledgement | Visit | no | no |
| Down-pill arrival cursor | Visit | no | no |

### 5.9 Worked example

1. You open chat A, which has three unread replies. You land at the end. The divider sits above the first unread reply. "↑ 3 New Messages" shows. The read mark advances at once.
2. You click the pill. The divider is placed a third of the way down. The pill goes. The divider stays.
3. You scroll up into older history. A new reply starts streaming and gets text. "↓ 1 New Message" shows. No divider appears for it, because you were focused.
4. You press ×. The pill goes and the view doesn't move. A second reply arrives. "↓ 1 New Message" shows again.
5. You switch to chat B and back to A. The divider is gone and A opens where you left it.
6. You unfocus the window and two replies arrive. You come back. A divider sits before the first of them, and the sidebar mark clears on focus.

---

## 6. Progress summaries

### 6.1 Grouping

1. Adjacent tool calls and thoughts in a turn join one **activity group**. The default density merges all tool kinds. Other densities group each kind separately. [glass.js:191603–191612, 191651–191664, 28927]
2. A group ends at assistant prose (even one short sentence), a user message, any standalone row, or 200 members. Later work starts a new group. [glass.js:191610, 191715]
3. A run with exactly one tool call shows that tool's own row, with no group header. A run that is only thinking is still a group, the "Thought" line. [glass.js:191580–191584, 191678–191684]
4. The latest group of a running turn stays live between calls, so its verb doesn't flicker to finished and back. [glass.js:192043, 192468]

### 6.2 Wording

| Group | Live | Finished |
|---|---|---|
| Thinking only | "Thinking", no duration | "Thought 8s", or a heading taken from the reasoning |
| Exploration (reads, lists, searches, fetches) | "Exploring 15 files, 12 searches, ran 4 commands" | "Explored 2 files, 2 searches" |
| Commands only | "Running 3 commands" | "Ran 3 commands". A single command shows its description |
| File changes | Change verb + files | Past-tense change verb + files |
| Pending approvals only | "1 tool pending" / "N tools pending" | same |

- Live groups keep their counts. Only a live thinking group hides details.
- The command fragment is always "ran N commands".
- A single file or directory shows its name instead of "1 file".
- Zero categories are left out.
- Order: directories, files, searches, fetches, lints, tools, browser actions, then commands. [glass.js:186425–186455, 186513–186600, 192500–192610]

### 6.3 Counts

- **Searches**: glob, grep, semantic, conversation and web searches, and tool discovery. Each call counts once.
- **Fetches**: each fetch call counts once.
- **Commands**: each shell call counts once.
- **Tools**: MCP calls, with browser actions counted separately.
- **Glass counts calls**: two reads of one file make "2 files", and failed calls count.
- **Nyte decision**: count unique paths and successful calls, as Nyte does today, and add the search bucket. A count that doesn't match what was actually read reads as a bug. [glass.js:176238–176290; Nyte `app/src/conversation/step-group-presentation.ts:78–127`]

### 6.4 "Thought 8s"

- Measures the **recorded reasoning time** of the thinking steps in that group, summed and rounded to the nearest second.
- Under 0.5 s, or with no recorded time, it reads "Thought briefly".
- When the reasoning begins with a heading and has no body, the heading replaces "Thought" and the duration is dropped. [glass.js:186364, 186515, 176244]

### 6.5 "Worked for 2m 47s"

1. **Where it appears**:
   - On a **finished turn**, everything before the final reply folds into a work group whose header reads "Worked for 2m 47s".
   - A routed model can be appended: "· Routed to <model>".
   - The final reply stays outside the fold.
   - The same text is the subtitle of the reply timestamp's tooltip. [glass.js:192225–192235, 208148–208157, 194593]
2. **Live**:
   - The header reads "Working", with no clock.
   - With background tasks still running, it reads "N Working". If the turn finished but tasks run on, it reads "N working" plus the task's status.
3. **What it measures**: **wall-clock time** from the earliest start of the turn's work to the later of the final reply's start and the last work completion. Only positive values show. [glass.js:191967–191972, 192144]
4. **Format**: rounded **up** to seconds.
   - Under 1 s: "1s".
   - Under 1 minute: "47s".
   - Under 1 hour: "2m 47s" ("2m" when the seconds are zero).
   - Otherwise: "1h 5m" or "1h". [glass.js:192022–192032]
5. **How it relates to "Thought"**:
   - A turn has one "Worked for" and can contain several "Thought" lines.
   - "Thought" sums model reasoning time inside one group and rounds to nearest. "Worked" is wall time across the turn and rounds up. The two are not added together or compared.
6. **Fold state**: a turn you watched run stays unfolded once it finishes. Turns loaded from history open folded. *Inferred; runtime check.* [glass.js:491359]

### 6.6 Expansion

- Clicking a summary line, or pressing Enter or Space on it (it's a native button with expanded state), toggles its members in order.
- Expanding a mixed group does not open each tool's output. Opening a thought-only group shows the reasoning text.
- Expanding anchors first (§3.3 rule 7). In Glass, it loads the group's members before showing them, so the expansion doesn't reflow twice. [glass.js:192556, 477572–477578]
- Fold state is stored per row (§2.3, 200 per chat).
- While a group is collapsed and live, a tail status line ("Thinking", the tool's activity, or "Planning next moves" before the next action) can open it. Its accessible name ends in "Open activity". [glass.js:191085–191103, 209696]

---

## 7. Blocks

### 7.1 Code citation card

- **Shown for** a code fence that carries a file path.
- **Header**: file icon, file name only (no folders), then "Ln a–b" when both line numbers are positive. The code sits below.
- **Header is one button.** When the file can be opened, the whole header, range included, opens the file with the cited lines selected. Modifier keys are ignored. [glass.js:109976, 110019–110058, 498246, 502305–502352]
- **Plain fence**: a fence without a path renders as plain code with no header.
- **Copy**: the copy control appears on hover or focus. It copies the code minus one trailing newline. It shows a check and the label "Copied" for 2 s. [glass.js:109404–109410, 110004–110009]

### 7.2 Links

- Inline code that names a workspace file becomes a link only after streaming stops *and* the file resolves. Until then it stays code.
- A resolved file link is a focusable button, activated by Enter or Space, and it keeps its line suffix. [glass.js:175136–175190]
- A prose link with no scheme, or one that names a file, opens the file, even with a leading slash.
- http(s) links go to the link handler. Cmd-click (macOS), Ctrl-click (other platforms) or middle-click opens them outside the app. Alt-click opens files to the side. Nyte keeps its own external-link policy. [glass.js:473671–473689, 476920–476932]

### 7.3 Actions row

1. **Where**: one row per turn that has a final reply, under that reply, once the turn is finished.
2. **Order**: feedback (thumbs up and down), copy (with an overflow menu), fork, reply, time. Each control is optional.
3. **Visibility**: the latest turn's time is always visible. Earlier turns show their time on hover; hover tracking clears while scrolling. [glass.js:194621, 194757, 399481, 400986, 477514]
4. **Copy**:
   - Copies the final reply's text. If that is blank, it copies the most recent earlier reply in the turn that has text. It never copies the whole transcript.
   - Shows a check and "Copied" for 2 s and ignores clicks during that time.
   - Glass also shows a "Message copied to clipboard" notice; Nyte drops it, since the check already confirms. [glass.js:194697–194710, 185909, 209859, 502597]
5. **Feedback**:
   - The selected thumb is filled and marked pressed, and it opens a feedback dialog.
   - Clicking the same thumb again clears it. Choosing the other thumb replaces it. [glass.js:209910]
6. **Fork**:
   - Creates a new chat that ends at this turn's last message and selects it.
   - Shows a spinner and "Forking chat" while pending, and ignores repeat clicks. [glass.js:194724–194731, 502508]
7. **Time**:
   - Shows "Just now" under a minute, then "4m ago", "4h ago", "3d ago", "2mo ago", "1y ago". It refreshes every minute.
   - Tooltip: the full date and time, then "Worked for …" (§6.5).
   - Accessible name: "Message sent <full time>". [glass.js:194540–194556, 194757–194770]

### 7.4 Inline link to a subagent

- **Text**: the link shows the text the parent wrote. When that text is empty or is the raw child ID, it shows the child's name, or the ID as a last resort. [glass.js:471508–471512]
- **Leading glyph**: an animated working glyph while the child is generating, otherwise the agent glyph. [glass.js:471662–471665]
- **Activation**: opens the child's preview, falling back to opening the child chat. If neither works, a notice says the subagent can't be found. [glass.js:783432–783444]

---

## 8. Attention rows inside the chat

| Event | Surface | Trigger | Shows | Count | Dismissed by | Expires | Evidence |
|---|---|---|---|---|---|---|---|
| Messages arrive while you're scrolled up | Floating pill, top of transcript | Not following, > 50 px from end, ≥ 1 incoming message after the arrival cursor | ↓ "N New Messages" × | Incoming message identities after the cursor; "30+" above 30 | × (cursor jumps to latest, no scroll). Click (go to end) | Reaching the end clears it. The next arrival restarts it | glass.js:679450–679466, 683921–683943 |
| Unread replies start above you | Same pill | A divider exists, sits above the viewport, and isn't acknowledged; no down count | ↑ "N New Messages" × | Unread assistant replies from the divider on | Click (jump, acknowledge). × (advance read mark, remove divider). Seeing the divider. A down count appearing | When you leave the chat | glass.js:679123, 679411–679449, 679471 |
| First unread reply | Inline row | Boundary fixed, and an assistant reply starts after it | 1 px rule, "New", 1 px rule | none | Up-pill × only | Next visit, or the boundary moving to following | glass.js:679120, 192337, 208108 |
| You're away from the end | Scroll-to-bottom button | Overflow and > 50 px from end | ↓ arrow, tooltip "Scroll to bottom" | none | Click (end + focus composer) | Reaching the end | glass.js:684280–684283 |
| Agent is between actions | Tail status row | Generating, with no newer activity | "Planning next moves" (or custom text), shimmer | none | none | The next activity or the end of the run | glass.js:209592–209697 |
| Work is running inside a collapsed group | Tail status row | A live group is collapsed | Current activity + "Open activity" (accessible name) | none | Click or Enter opens the group | Group settles | glass.js:191085, 209418–209436 |
| Child agent is working | Inline subagent link | Child generating | Animated glyph | none | none | Child stops | glass.js:471662 |
| Copy succeeded | Copy control | Copy | Check + "Copied" | none | none | 2 s | glass.js:110009, 185909 |

---

## 9. Proportions

Glass values were measured from `glass.css` and from inline styles in `glass.js`. Map them onto Nyte tokens in `app/src/theme/tokens.stylex.ts` and `ui/src/styles/tokens.stylex.ts`.

| Measure | Glass 3.28.5 | Nyte today | Map / decision |
|---|---|---|---|
| Column box | 780 px default chat width + 16 px scrollbar-gutter reserve = **796 px**, centred. A user setting overrides it. (840 px is only a CSS fallback.) [glass.js:535540–535545, 575194] | `--nyte-conversation-measure` 840 px (preference, 600–1600) | Keep 840 as Nyte's default. Glass's narrower column comes from its smaller type (below), not from a different line length |
| Inline gutter | 16 px each side, inside the box → 764 px text column [glass.js:504323] | `--nyte-conversation-gutter` 16 px → 808 px | Keep |
| Prose inset | Assistant and tool rows sit a further 13 px in on each side (bubble radius + 1), so prose lines up inside the prompt bubble's corners. Prompts are not inset. [glass.css row-body rule] | Not checked | Adopt: a reply's prose starts where the prompt's text starts |
| Text | 14 px / 22 px line height [`--conversation-text-font-size`, `--conversation-line-height`] | `text.lg`: 15 px / 24 px at 13 px base | Keep Nyte's type. Line length is about 100 characters in both |
| Gap between rows | 14 px uniform | `--nyte-conversation-turn-gap` 14 px before a turn; `--nyte-conversation-row-gap` 8 px within a turn | Keep Nyte's two-level rhythm. It shows turn boundaries better |
| Consecutive prompts | 4 px join | Not modelled | Adopt 4 px when prompts follow one another |
| Before a steer message | 28 px | Not modelled | Use 2 × turn gap |
| Prompt bubble | Padding 8 px vertical, 12 px horizontal; 12 px radius; 1 px border; minimum width 150 px | Padding 8 / 10 px; radius `--nyte-shape-card` 12 px; 1 px border (`app/src/conversation/turn.stylex.ts:6–8, 35–55`) | Move horizontal padding to 12 px |
| Collapsed prompt | 3.5 lines → 77 px of text, about 95 px with padding and border. "Show more" variant: 12.5 lines | 3.5 lines → 84 px, about 102 px (`turn.stylex.ts:12, 96–100`) | Keep. This is also the pinned prompt's maximum height |
| Pinned prompt | Sticks at the top inset (0 by default). 4 px below its sticky region. 2 px activation | Top 0, 2 px epsilon, active background + small shadow | Keep. Add 4 px below |
| Top fade | 32 px fade when not at the top | `--nyte-conversation-edge-fade` 32 px | Same |
| Divider | Row ≥ 28 px; 4 px above, 8 px below; 1 px rules either side of the label, 8 px gaps; label 12 / 16 px in the accent colour | absent | Adopt. Use Nyte's accent and small text tokens |
| Time boundary | 28 px row, inserted after a gap of more than 1 hour | Not checked | Optional |
| Pill | 28 px tall, 8 px radius, outline, elevated background, small shadow, 12 px from the transcript top, centred on the column | absent | Adopt. Use Nyte's md control height and pill shape |
| Last row to composer | Composer floats over the transcript. The end spacer is the composer's height + 14 px. Content scrolls under the composer and fades out over 38 px | Composer is docked. The last row ends 114 px above it (`app/src/conversation/transcript-scroll.ts:5`) | Keep Nyte's docked composer (rule 13 in Nyte's transcript.md) |
| Tool card | Padding 10 px horizontal, 8 px vertical; 6 px gap; 16 px between blocks | `--nyte-prose-paragraph-gap` 16 px | Keep |

---

## 10. Nyte delta

| Behaviour | Nyte today | Decision | Why |
|---|---|---|---|
| Row model and keys | `app/src/conversation/transcript-rows.ts:141–211, 220–290` | Keep | Keys already come from messages and survive streaming |
| Kind estimates | `transcript-rows.ts:509–599` (prompt 76, step 64/140/240, prose 40 + 24 per 90 chars, scaled by font) | Keep | Already proportional. Reaching Glass precision doesn't need a copy of its numbers |
| Height cache | `app/src/conversation/transcript.tsx:53–55, 233, 518–524`: 16 snapshots in memory, keyed by chat and pane only | Change to §2.3: key by layout (width, DPR, font, density) and row revision; per-row, LRU | A snapshot taken at another width or font is reused as is |
| Disk height cache | absent | Defer | Glass does it, but Nyte's restore problems come from anchoring, not cold estimates. Revisit after journey 3 measures reflow |
| Follow tolerance | 1 px (`transcript.tsx:346`, `transcript.md` rule 4) | Change to 4 px | Fractional scroll offsets at non-integer zoom can leave 1–3 px |
| Release | Any wheel, touch move, scrollbar press or navigation key releases (`transcript.tsx:657–686`) | Change to upward-only, attributed within 250 ms (§3.2) | A downward wheel at the end shouldn't leave following |
| Smooth follow | Instant (`transcript.tsx:275`) | Optional | Glass glides small streamed deltas. Not a correctness issue |
| Reading anchor and compensation | `transcript.tsx:268–298, 413–422` | Keep | Matches §3.3 |
| Hold corrections during a gesture | absent | Add | Stops above-fold re-measures from moving text under a dragging pointer |
| History lead | 3 screens (`transcript.tsx:47, 302–321`) | Keep | Already more generous than Glass's 2 |
| Saved position | `transcript.tsx:487–527`; in memory, 64 chats (`app/src/layout/session-view-state.ts:11, 29–31`) | Keep, plus a fallback | When the anchor row is missing, Nyte opens near the estimated end in reading mode (`transcript.tsx:258–264, 472–484`). Open following the end instead |
| Reveal after settle | Not checked | Verify | §3.5 rule 4 |
| Pinned prompt | `transcript.tsx:57–106`; `transcript-scroll.ts:21–37`; `turn.stylex.ts:72–86` | Keep; check the selection rule | Already bounded to its turn and excludes tall prompts. Make sure a too-tall latest prompt doesn't fall back to an earlier one |
| Read mark | Seen commit per head, persisted (`core/src/fold/seen.ts:18`); advanced when shown, visible, focused and uncovered (`app/src/screens/session-conversation.tsx:250–296`); clients get only `unread` (`schema/src/sessions.ts:19`) | Expose the seen mark to the client | The divider needs the mark as it was before this visit. Messages carry `at` (`schema/src/views.ts:25`). Schema change: run `pnpm --dir packages/host check:store` |
| Divider + up pill | absent | Add (§5.3–5.6) | The feature the user asked for |
| Down pill | absent | Add (§5.5) | Separate from the scroll-to-bottom button |
| Scroll-to-bottom button | `transcript.tsx:734–767`, 60 px threshold (`transcript-scroll.ts:62–72`); blurs on click | Keep; focus the composer after the jump | Matches Glass, and it's the next thing the user does |
| Live group counts | Hidden while live (`app/src/conversation/step-group.tsx:275–285`) | Show counts while live | Live progress is the point of the line |
| Live verb | Follows the latest running tool (`app/src/conversation/step-group-presentation.ts:254–265`) | Use the group's aggregate verb | Stops "Exploring" flipping to "Running" for one command |
| Search bucket | absent (`step-group-presentation.ts:104–126`) | Add | "Explored 2 files, 2 searches" needs it |
| Unique-path counts | `step-group-presentation.ts:78–127` | Keep (deliberately differs from Glass) | Counts what was actually read |
| "Thought Ns" | Thought-only groups use the group's time span (`step-group.tsx:140–146`, `step-group-presentation.ts:130–141`) | Keep | For a thought-only group, the span is the reasoning time |
| "Worked for …" | absent | Add the work group and the tooltip line (§6.5) | Gives each finished turn one line, with its duration |
| Citation card | absent (`app/src/conversation/code-block.tsx:125–135` takes only code and language) | Add | File + "Ln a–b" header that opens the file |
| Code copy confirmation | Stays while the code is unchanged (`code-block.tsx:137–138, 176–180`) | 2 s reset | Otherwise the check looks permanent |
| Reply actions row | absent (`app/src/conversation/turn-view.tsx:646–651`) | Add copy + time first. Fork later, via head creation at the reply (`sdk/src/client.ts:164`; input shape not checked). Drop feedback | Feedback has nowhere to go in Nyte |
| Inline subagent link | `app/src/conversation/subagent-call.tsx:563–611`; static agent icon | Add the working glyph | Shows that the child is still running |

---

## 11. Acceptance journeys (desktop e2e)

Run each through the Electron Playwright harness with the bench models. Each one asserts on every painted frame where it says "never".

1. **Stream, read, rejoin**
   1. Open a long chat at the end and start a reply that streams over several viewports. Assert that the last row's bottom stays within 4 px of the end on every frame.
   2. Wheel up 300 px mid-stream. Assert the topmost visible row's offset doesn't change by more than 1 px while streaming continues.
   3. Expand a group above the reading position. Assert the clicked control doesn't move.
   4. Wheel down to the end. Assert following resumes. Wheel down again at the end and assert following stays.

2. **Pill and divider**
   1. Seed chat A with a read mark three replies back. Open it. Assert one "New" divider sits before the first unread reply, and that "↑ 3 New Messages" shows.
   2. Click the pill. Assert the divider's top is at viewport height ÷ 3 (±2 px), the pill is gone, and the divider remains.
   3. Scroll to the end, then up 400 px, and let one reply stream in. Assert "↓ 1 New Message", and that it stays 1 as text streams.
   4. Press ×. Assert the scroll offset is unchanged and the pill is gone. Let a second reply arrive and assert "↓ 1 New Message" again.
   5. Click it. Assert following at the end. Assert the divider is still there.
   6. Switch to chat B and back. Assert no divider.
   7. Blur the window, let two replies arrive, and focus it. Assert a divider before the first of them and that the sidebar unread mark clears.

3. **Reopen at a saved position**
   1. In chat A, scroll to the middle, and note the topmost row's key and offset.
   2. Switch to chat B, then back. Assert the same row is at the same offset (±1 px) on the first painted frame, with no visible movement afterwards.
   3. Delete or regenerate that row's message from the other pane, then return. Assert the chat opens following the end.
   4. Resize the pane while reading. Assert the anchor row keeps its offset.

4. **History and pinned prompt**
   1. Open a chat longer than one page and scroll to the top. Assert earlier messages load, and the row that was topmost keeps its offset (±1 px) across each prepend.
   2. Scroll through a turn whose prompt is shorter than the viewport. Assert the prompt sits at the top edge until the next prompt reaches it, and that only one prompt is pinned.
   3. Make a prompt taller than the viewport. Assert nothing pins over its turn.

5. **Progress summaries**
   1. Run a turn of: reasoning, one short sentence, two reads and two searches, then four commands.
   2. While live, assert "Thinking", then "Exploring 2 files, 2 searches, ran 4 commands".
   3. When finished, assert "Thought Ns", "Explored 2 files, 2 searches, ran 4 commands", and one "Worked for …" line over the finished turn's work, with the final reply outside it.
   4. Hover the reply's time and assert the tooltip ends "Worked for …".

6. **Blocks**
   1. Render a reply with a cited fence (path, lines 16–21) and a resolved inline file reference.
   2. Click "Ln 16–21". Assert the file opens with lines 16–21 selected.
   3. Copy the code, then the reply. Assert each check resets after 2 s and that the clipboard holds code-only, then reply-only text.

---

## 12. Runtime checks still needed

- Pill and divider pixel placement, and whether the up-pill jump is instant, in Glass (audit list items 2, 5).
- Whether a finished turn's "Worked for" group stays unfolded after you watched it, and folds after a restart (§6.5 rule 6).
- "Ln 16–16" versus no range for single-line citations.
- Whether the live "Exploring" label animates (a shimmer or an ellipsis).
- What a screen reader announces when a pill appears. Glass sets no live region. Nyte should add a polite one.
- Whether a Glass chat in a background tab advances its read mark. The rule needs the chat shown, which is expected to mean no.

---

## 13. Engine recommendation *(recommendation, not spec)*

**The recommendation: stay on TanStack (b) and implement §2–§5 as Nyte-owned rules. Don't finish the Legend migration. Keep a small custom plane (c) as the fallback if TanStack's measure-and-adjust loop blocks §3.3 rule 6.**

### What Glass shows

- Glass ships TanStack and uses it for its diff lists, but the chat runs on a custom plane. [glass.js:477489 vs 663453, 665509]
- What makes Glass's chat feel stable isn't the windowing. It's four policies:
  - one owner for every scroll write, with browser anchoring off;
  - anchors by row identity;
  - release only on attributed upward input;
  - measurement rules: one correction per revision, streaming rows only grow.
- None of these depend on a library. Glass shipped them as its own policy rather than trusting a library's defaults.

### (a) Finish Legend + patch

Cost: Nyte carries a 360-line patch against Legend's built files, across five internals, and re-applies it on every upgrade.

The migration gives up three things:
- the per-kind estimates (one 120 px estimate for every row);
- the mode machine, handing following to the library's end-maintenance;
- the size cache.

Its two open problems sit exactly on the rules this spec depends on:
- the pinned prompt goes stale after scrolling to the top (§4);
- frame coverage fails intermittently (Nyte's rule 22, "rows never leave the visible range unrendered").

Ownership of scroll writes would be split between library and app, which is the opposite of Glass's design. *Evidence: legend-transcript worktree `packages/app/src/conversation/transcript.tsx:32–43, 286–318`, `patches/@legendapp__list@3.7.0.patch`, and the known issues in the brief.*

### (b) TanStack + app rules

Nyte already owns:
- following and reading (`transcript-mode.ts`);
- anchor compensation, with the library's own adjustment turned off while a reading anchor exists (`transcript.tsx:413–422`);
- sticky retention (`transcript.tsx:57–106`);
- a frame-coverage harness (`transcript-frames.browser-test.tsx`);
- a written rule set (`app/src/conversation/transcript.md`).

Cost:
- the layout-keyed per-row height cache (§2.3);
- direction-aware release and the 4 px rejoin;
- holding corrections during a gesture;
- the restore fallback.

Each of these is a contained change in `transcript.tsx` or `transcript-mode.ts`. The unread model (§5) is library-neutral in every option and costs the same everywhere.

Risk: TanStack still measures and offers adjustments, so Nyte has to keep vetoing it. That is a second writer that has to keep agreeing with the app.

### (c) Small custom plane

Nyte would own offsets, the visible window (rows plus pixels, as Glass bounds it), sticky retention, measurement and scroll writes. Glass proves the shape works.

Cost: Glass's version includes a geometry planner, measurement policies and held corrections. A Nyte-sized version replaces about 770 lines of adapter with its own code and tests, and it gives up TanStack's maintained edge cases. Choose it only if (b) can't satisfy §3.3 rule 6 or §2.2 without fighting the library.

### Pretext

- Glass uses pretext in ordinary chat for one job: computing heights for older, collapsed, plain-text prompts.
- Before trusting a computed height, Glass checks it four ways:
  - it calibrates the prompt bubble's padding and border against a mounted prompt of at least 80 characters;
  - it measures at both the full and the narrowed width and requires the same line count;
  - it rejects any text with images or other non-text content;
  - it rejects overflowing runs.

  [glass.js:477855–477935, 478058, 504301]
- In Nyte, a collapsed prompt is at most 3.5 lines, so the worst estimate miss for a prompt is about 60 px. That's not where Nyte's jumps come from.

**Pretext recommendation: don't adopt it now.** Revisit only for plain-text prompts, with the same eligibility checks, if journey 3 still shows visible reflow on cold open after the layout-keyed cache lands. Never use it for Markdown replies or tool rows.
