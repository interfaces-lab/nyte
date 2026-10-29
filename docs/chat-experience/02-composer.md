# 02 · Composer

What Cursor Glass 3.28.5's chat composer does, in our own words, and what Nyte should do. The audit trail is in `audits/composer-audit.md`.

Evidence tags: `[code glass.js:N]` points to the formatted Glass bundle. `[inferred: …]` marks a reading of code that runtime has not confirmed. Quoted strings are Cursor's UI labels, cited as evidence. Nyte paths are relative to `packages/app/src/`.

## Purpose

The composer is where the user talks to the agent: starting work, adding to work in progress, and correcting work in flight. It has to make one thing obvious at every moment: what Enter will do. Enter can send, wait its turn, slip into the running response, or do nothing, and the user should never have to guess which. It also collects context (files, chats, images, pasted text) as structured pieces rather than flat text.

## Composer states

Defaults assumed: Enter submits, the running-message setting is **Queue**, and the queued-message action is **Interrupt**. These are Glass's shipped defaults [code glass.js:832138]. "Alternate" means Cmd+Enter on macOS and Ctrl+Enter elsewhere. When the user enables "submit with Cmd+Enter", every binding moves up one modifier: Cmd/Ctrl+Enter submits and Cmd/Ctrl+Alt+Enter is the alternate [code glass.js:238225–238229].

| State | Placeholder | Send / Enter / Esc do | How the user gets here | Evidence |
| --- | --- | --- | --- | --- |
| Idle, empty | "Send follow-up" ("Follow up" when compact) | The send slot shows a mic when voice is on; otherwise send is disabled. Enter does nothing. Esc is not handled by the composer (see Focus rules). | Open a chat; send a message and let the run finish | [code glass.js:679520–679524, 480804–480816] |
| Idle, draft | same | Send and Enter start a new turn. The composer clears at once. If sending fails, the draft (text, images, video) comes back with no toast. Esc is not handled. | Type, paste, or add a mention or attachment | [code glass.js:562557–562608] |
| Running, empty | "Send follow-up" (or "Steer without interrupting" when the setting is Steer) | The send slot becomes **Stop** (tooltip "Stop" with its shortcut; accessible name "Stop generation"). Enter does nothing unless messages are waiting (see below). | Send while idle | [code glass.js:480604–480636] |
| Running, draft, setting Queue | "Send follow-up" | Enter and Send add the message to the waiting list, clear the composer, and leave the run going. **Alternate stops the run and sends now.** The send tooltip reads "Queue"; the accessible name is "Queue message". | Type while the agent works | [code glass.js:324974–324978, 765970–765972, 561863–561868, 480619] |
| Running, draft, setting Steer | "Steer without interrupting" | Enter steers: the message appears in the transcript at once and goes into the running response without stopping it. Alternate queues instead. If the run declines the steer, the message leaves the transcript and returns to the waiting list. One fallback per run may escalate to stop-and-send. | Settings › new messages = Steer, then type during a run | [code glass.js:324971–324973, 684310, 766037–766107] |
| Running, draft, setting Stop-and-send | "Send follow-up" | Enter stops the run and sends. Alternate queues. | Settings › new messages = Stop and send | [code glass.js:324971–324973; label: inferred: the label helper has no stop-and-send case, runtime check 7] |
| Running, steering unavailable | "Send follow-up" | A requested steer falls back: a primary submit queues, and an alternate submit stops and sends. While the chat is summarizing, every submit queues. | Model or run cannot take steering, or the chat is summarizing | [code glass.js:324981–324983, 765960, 766020–766022] |
| Waiting messages, composer empty | as above | Enter or Send delivers the **first** waiting message. If the queued-message action is Steer and steering is available, the message is steered; otherwise it is sent now, interrupting the run. If the first message is already being delivered, nothing happens. | Queue at least one message, leave the composer empty | [code glass.js:562488–562497, 766033–766036] |
| Editing a waiting message | the queued text | The send icon becomes a check; its tooltip is "Save" and its accessible name "Save edit". While running, saving updates the waiting message in place; while idle, saving sends it. Esc cancels the edit and restores the earlier draft. | Edit (pencil), double-click, or Right Arrow on a waiting row | [code glass.js:562362–562373, 562569–562596, 480600, 480619, 684322] |
| Suggestion menu open | — | Enter picks the highlighted item. Esc closes the menu. Submit shortcuts do not fire. | Type `@` or `/` | [code glass.js:238213, 238219, 238225] |
| Recording voice | — | A waveform, timer, cancel and check replace the controls, and the model picker hides. The check ends the recording and inserts the text; it does not send. | Click or hold the mic; Control+M (hold) or Cmd/Ctrl+Shift+Space | [code glass.js:480774–480777, 882180, 882200; inferred: check stops capture, glass.js:484715] |
| Processing voice | — | Send is disabled and shows a spinner: "Processing voice input…" | Finish a recording | [code glass.js:480779–480781] |
| Subagent tab, follow-ups not allowed | "Follow-ups aren't available for this subagent" | The input is read-only. Send does nothing, and Stop is hidden. Any draft already typed is **cleared** when the lock takes effect, and the editor loses focus. Messages are never redirected to the parent. | Open a child agent whose source does not accept follow-ups | [code glass.js:567305–567310, 847843–847845, 848026–848028, 565994–565998] |
| Worktree setup failed | "Worktree setup failed" | Read-only, as in the locked subagent tab | Agent's worktree setup fails | [code glass.js:684310 (locked flag), 847843] |
| Subagent tab, follow-ups allowed | "Send follow-up" | Behaves like a normal chat and sends to the child | Open a child that accepts follow-ups | [code glass.js:567310] |
| Subagent preview open in parent | "Send follow-up with subagent" | Send goes to the **parent**. It attaches a reference to the previewed child and closes the preview. | Open a child's preview from the subagents tray | [code glass.js:562547–562555, 684310] |
| Stopping | — | Glass shows no "stopping" state; the run simply ends. What happens to waiting messages after Stop is unverified. | Click Stop, or use the stop shortcut | [code glass.js:359958–359977; runtime check 1] |

Two more rules are rarely visible. A message sent with a "prefer steer" flag steers even when the setting is Queue. And a stop-and-send requested from code (not from the keyboard) queues instead [code glass.js:324983, 369338].

## Waiting messages (queue vs steer)

**Queue.** A queued message waits outside the transcript, in a tray above the composer. Each row shows a one-line preview. A dock chip labelled "Queued" with a count toggles the tray. The tray opens by itself when the first message arrives. Once the user closes it, more messages do not reopen it, and switching chats closes it [code glass.js:598124, 581454–581455, 588428–588432]. When the run ends, Glass sends the first waiting message automatically, unless that message is being edited [code glass.js:765891–765895, 765976–765977]. Each message keeps the model and mode it was written with, and editing restores them in the picker [code glass.js:765971, 562371]. The queue persists with the chat [code glass.js:765908–765911].

**Steer.** A steered message goes straight into the transcript as a normal user message, and the agent picks it up mid-run. The first successful steer shows a one-time toast: "Your message steered Agent without stopping it" / "New Messages is set to Steer", with "Open Settings" (15 s) [code glass.js:451671–451677, 558068].

**The faded message.** Glass dims a user message only when it sits after a message being edited, or when review blocks it. Waiting and steered messages are not dimmed [code glass.js:479893, 479904]. Whatever faded message the user saw needs a runtime check (audit check 2). Nyte today fades a message the run has accepted but not yet taken in, with the title "Lands at the next response" [conversation/turn-view.tsx:328–329].

**Row actions.**

| Action | Does | Evidence |
| --- | --- | --- |
| Primary button | "Steer" (tooltip "Sends without interrupting the agent") when the queued-message action is Steer and steering is available. Otherwise "Send Now" ("Sends now, interrupting the agent"). Holding Cmd (macOS) or Ctrl flips the choice. | [code glass.js:459683–459685, 598105–598110] |
| Edit (pencil), double-click, Right Arrow | Loads the message into the composer and holds it from automatic sending. The row shows "Editing" and hides its action buttons. | [code glass.js:588523, 588652, 588691, 882120] |
| Send Now on a row being edited | Saves the edit, then sends | [code glass.js:562374–562398] |
| Remove (trash), Cmd+Backspace / Ctrl+Delete | Removes the row. Removing the row being edited also cancels the edit. On failure: "Failed to remove queued message." | [code glass.js:598119, 882124, 577970] |
| More (…) menu | "Move to Side Chat" (if available), the opposite delivery ("Interrupt": "Stop Agent and send message", or "Steer"), and "New Message Settings" | [code glass.js:588652, 459685] |
| Drag | Reorders rows. New messages append to the end. | [code glass.js:588682–588684, 766239–766242] |
| Cancel edit | Restores the draft that was in the composer before the edit. On failure: "Couldn't cancel the edit. Try again." | [code glass.js:562403, 558208–558214] |

**Steer suggestion.** Steering may be available while the setting is not Steer. In that case the queue tray shows a banner, at most twice and 14 days apart: "Steer New Messages?", "Keep Queuing", "Open Settings". Either button dismisses it for good [code glass.js:461292, 577979–577985, 596466–596485].

## Insertables

| Trigger | Inserts | Renders as | Evidence |
| --- | --- | --- | --- |
| `@` | Files and folders (ranked by recency), terminals, past chats, canvases, branch diff, browser | Inline chip carrying its type and target | [code glass.js:321210–321264, 564650–564651] |
| `/` | Commands, rules and skills, subagents, plugin actions, modes, and "model" (opens the picker) or a model name (switches model) | Command chip, mode change, or an action that runs right away | [code glass.js:566105–566124; inferred: sources at 483620–483629] |
| `/compact` or `/summarize` alone | Summarizes the chat and clears the composer; nothing is sent | — | [code glass.js:565770–565773] |
| "+" button | Searchable tray: "Search skills, context, chats...". Contains modes, skills, context, "Image"/"Attach", and "More"/"MCP". Accessible name "Add agents, context, tools"; tooltip "Modes, skills, MCPs and more" | Same chips; files go through the system picker (multiple selection) | [code glass.js:236456–236461, 481552–481561, 482002–482028] |
| Paste or drop images and video | Media | Preview grid above the editor. Removing an item returns focus to the editor. | [code glass.js:566177–566190, 566287–566290, 566314] |
| Paste or drop files that have a path | File or folder mentions (a reference, not an upload) | Chip | [code glass.js:483151–483181] |
| Paste text over 10,000 characters | A clipboard reference | Chip "Clipboard (N lines)" | [code glass.js:206659–206675, 566204–566209] |
| Paste a code selection copied in-app | A code reference with file and line range | Chip | [code glass.js:566208–566215; inferred: matching at 440264–440274] |
| Paste rich content copied from the composer | Keeps the mention and command chips | Chips | [code glass.js:238747–238755] |
| Shift-paste | Plain text and nothing else | Text | [code glass.js:566157–566176] |
| Type or paste a URL | Link styling only; it does not open on click and is not fetched | Link text | [code glass.js:238349–238353] |
| Cmd/Ctrl+B, I, U | Nothing: the composer is plain text | — | [code glass.js:238219] |

## Dock row and footer

**Dock row** (one line between the transcript and the composer).

| Control | Shows | Does | Evidence |
| --- | --- | --- | --- |
| Chips, in fixed rank | Queued, debug, forms, environment setup, review, status, subagents, PRs, subscriptions, terminals, canvas, plan, goal, then host actions. Only chips with data appear. | Each toggles its own tray or runs its action | [code glass.js:564951, 586029–586064] |
| "1 Terminal" / "N Terminals" | A count of this agent's terminals. A small loader appears while any of them runs. Accessible name "Open terminals (N)". | Toggles the terminal list. The chip stays visible and shows as pressed while the list is open. Picking a terminal opens it and closes the list. Never opens by itself. | [code glass.js:595623–595654, 595704] |
| Down arrow | Shown when the transcript is scrolled away from the bottom and this is not a subagent view. No count. Tooltip and name: "Scroll to bottom". | Scrolls to the bottom **and focuses the composer** | [code glass.js:586002–586004, 684282–684283] |
| Blocking tray | — | A blocking tray (question, approval) hides the dock row while it is open | [code glass.js:565016, 586064] |

**Footer** (below the composer; on by default, toggled with "Show/Hide Status Bar") [code glass.js:266493, 884361].

| Segment | Shows | Does | Evidence |
| --- | --- | --- | --- |
| Branch, e.g. "main" | Current Git branch | Local chat with one repository: a searchable branch menu with checkout and "Create Branch". Otherwise click copies the name. | [code glass.js:569377, 569410–569415, 600254–600391] |
| Machine, e.g. "This Mac" | Where the agent runs ("This PC" / "This Computer" on other platforms) | Menu "Continue on" moves the agent elsewhere (Cursor cloud) | [code glass.js:467331–467332, 600520–600561] |
| Context ring (right) | Filled arc showing how much of the context window is used. Hidden when unknown. | Hover: "{N}% context used" plus "{N} tokens". Click toggles the context breakdown when available. | [code glass.js:600637, 600843–600871] |

## Model picker

- **Trigger.** Model name, optional variant detail (for example "High"), optional "MAX", chevron. Shows a spinner while the catalog loads and a warning icon on alert [code glass.js:445437–445446]. Tooltip "Select Model"; shortcut Cmd/Ctrl+/ when no other text field has focus [code glass.js:566066, 882295].
- **Dot.** A dot before the name means "new models you haven't seen". It is not status. Opening the model list clears it [code glass.js:563001–563012, 227485–227489].
- **Menu.** Opens either parameters first (effort, speed and other catalog-defined settings) with a "Model" submenu, or the model list directly, depending on configuration. The list is searchable ("Search models", "No models found"). One model at a time [code glass.js:228374–228397, 565917; inferred: 563171–563174, 563292].
- **Cycle parameter.** Cmd+Shift+/ (macOS), Ctrl+Alt+/ (Windows) cycles the model's main parameter [code glass.js:882295].
- **Effect.** Changes this chat's model **and** the default for new chats. It never sends or stops anything. Queued messages keep the model they were written with [code glass.js:563141–563145, 765971].

## Focus rules

1. Opening or activating a chat focuses the composer, unless something covers it, another editable field has focus, or the user has already pressed a key or clicked [code glass.js:684030–684076].
2. Typing a printable key while focus is outside any text field, with no modal open, focuses the composer and inserts the character. Cmd/Ctrl+V pastes into the composer the same way [code glass.js:562754–562785].
3. Closing the model picker returns focus to the composer [inferred: glass.js:564727–564737; runtime check 9].
4. Removing an attachment, starting an edit, and starting dictation focus the composer [code glass.js:566287–566290, 562371, 484700].
5. The down arrow focuses the composer after scrolling [code glass.js:684283].
6. Esc on a focused queue row returns focus to the composer [code glass.js:882130–882131].
7. When the composer turns read-only it loses focus [code glass.js:565997].

**Esc order in the composer:** suggestion menu, then cancel edit, then close the active tray, then nothing. Esc **never stops the agent** in Glass. An Esc nobody handles toggles the side editor panel. While a tray is up and the panel is hidden, Esc is swallowed instead [code glass.js:238219, 564915–564919, 684322, 884583–884584, 585721–585726].

## Keyboard and accessibility

| Keys | Where | Does | Evidence |
| --- | --- | --- | --- |
| Enter / Shift+Enter | Composer | Submit / new line. Shift+Enter continues or leaves a list. | [code glass.js:238219–238225] |
| Cmd/Ctrl+Enter | Composer | Alternate submit (see the state table) | [code glass.js:238225–238228] |
| Ctrl+Alt+Up / Down | Composer, macOS | Steps through your last 10 prompts in this chat; Down past the newest restores the draft | [code glass.js:238218, 444147–444178, 563695–563748] |
| Up at the top of the prompt | Composer | Moves focus into the open tray (for example the last queued row) | [inferred: glass.js:598159, 238229] |
| Ctrl+C with no selection | Composer, during a run | Stops the agent | [code glass.js:480122–480124, 480430–480431] |
| Ctrl+C (macOS), Cmd/Ctrl+Shift+Backspace | Anywhere except a terminal | Stops the agent | [code glass.js:882203] |
| Up/Down, Enter/Space/Cmd+Enter, Right, Cmd+Backspace / Ctrl+Delete, Esc | Focused queue row | Move, deliver, edit, remove, back to composer | [code glass.js:881641–881647, 882120–882131] |
| Cmd/Ctrl+/ | No text field focused | Open model picker | [code glass.js:882295] |
| Control+M (hold), Cmd/Ctrl+Shift+Space | Anywhere | Hold to talk / toggle dictation | [code glass.js:882180, 882200] |

Accessibility. The queue is a listbox named "Queued messages" that uses an active descendant; each row is an option, and its buttons have their own names [code glass.js:588730, 588527, 588652]. The send button's name follows the state ("Send message", "Queue message", "Steer message", "Stop generation", "Save edit", "Processing voice input…") [code glass.js:480619]. The model dot is hidden from assistive tech, and a loading picker is marked busy [code glass.js:445446]. Dock chips expose their expanded state [code glass.js:595638]. None of this has been tested with a screen reader.

## Proportions

Measured from Glass's stylesheet and the token values in its bundle. Glass works on a 4 px grid. Its control heights are 20 / 24 / 28 / 32 px (sm/md/lg/xl), and its radius scale is 2, 4, 6, 8, 12, 14, 16, 18 px and full [code glass.js:398655–398663, 109281]. The right-hand columns map each value to Nyte's tokens (`packages/ui/src/styles/tokens.stylex.ts`, `packages/app/src/theme/tokens.stylex.ts`) and to Nyte's current composer (`conversation/composer.stylex.ts`).

| Measure | Glass | Nyte today | Nyte token to use | Evidence |
| --- | --- | --- | --- | --- |
| Chat column width | 780 px + 16 px scrollbar gutter = 796 px, user-adjustable (976 px in project views). 840 px is only the CSS fallback. | 840 px (`chatWidth` preference) | `conversation.measure`. Consider 800 px as the default. | [code glass.js:535535, 535540–535544, 540252–540256] |
| Composer vs transcript | Same max width, centered together. Transcript rows have 16 px side padding (12 px in previews). The transcript keeps composer height + 44 px clear at the bottom. | Same width; 16 px gutter on both | `conversation.gutter` (16) | [code glass.js:575194–575196, 601316, 564925–564926] |
| Floating overlays (unread pill) | Pinned to the transcript column's edges, max width = column − 24 px | — | — | [glass.css anchor rules on the transcript content] |
| Container | 1 px border, **20 px** radius | 18 px expanded, pill when compact (40 px), 22 px new chat | `conversation.composerExpandedRadius` → 20 | [code glass.js:241600–241700 (prompt-input base)] |
| Editor text | 15 px / 24 px line, −0.24 px tracking | 15 / 24 (`type.fontLg` / `leadingLg`) | Already matches | [glass.css body glass-mode rule] |
| Editor padding | 8 px top/bottom, 12 px sides | 8 / 12 expanded | `space.s2` / `space.s3`. Matches. | [code glass.js:237900–237960] |
| Editor height | Minimum **36 px**. Grows one line (24 px) at a time as you type; at 200 px it stops growing and scrolls inside. | Minimum 54 px expanded; maximum 200 px | Minimum 36 px; keep 200 px | [code glass.js:241600–241700, 237900–237960] |
| Toolbar | 8 px padding on all sides; 8 px between the left and right groups; 4 px between controls in a group | 8 px inset; 2 px between controls (`target.gap`) | `space.s2` padding, `space.s1` between controls | [code glass.js:240990–241120] |
| Send / Stop | 24 px circle | 28 px (`button.heightMd`) | `button.heightSm` (24) | [code glass.js:240983–240987, 480827] |
| Total composer height | About 82 px at one line (border + 40 px editor row + 40 px toolbar). At most about 242 px. | 40 px compact pill, about 96 px expanded | — | [inferred: sum of the rows above; runtime check 4] |
| Gap between dock or trays and the composer | 8 px (6 px in the base component) | 6 px (`tray.gap`) | `tray.gap` → 8 | [code glass.js:576539, 241600–241700] |
| Dock chip | **28 px** tall (large button), 4 px gap between chips, 4 px between count and label; never wraps | 24 px pill (`size="sm"`), 6 px gap | `button.heightMd` (28), `space.s1` | [code glass.js:581374–581395, 109281, 585780–586070; radius: runtime check 6] |
| Footer row | 12 px text, 18 px line, tertiary color. Padding 8 px top, 2 px bottom, 4 px sides, behind a 1 px transparent border. Left and right groups 8 px apart. About 32 px tall. | none | `type.fontSm`, `space.s2` / `space.s0_5` / `space.s1` | [code glass.js:600893 root classes; glass.css] |
| Footer segment | 20 px tall, 4 px side padding, 4 px radius, 4 px icon-to-label gap. The machine segment is at most 248 px wide. The context ring button is 20 px square. | none | `button.heightXs` (20), `radius.indicator` (4) | [code glass.js:600640–601000] |
| Distance to window bottom | Unknown | 14 px (`composerInset`) | Keep | [runtime check 5] |

Nyte currently differs from Glass on: column width (840 vs 796 px), container radius (18 vs 20 px), editor minimum height (54 vs 36 px), send button (28 vs 24 px), dock chip (24 vs 28 px), the gap between controls (2 vs 4 px), the tray gap (6 vs 8 px) and the footer (Nyte has none). Nyte's compact one-row pill is its own design; Glass also has a compact form, and whether it is the resting state is runtime check 4. The text size, editor padding and 200 px cap already match.

## Nyte delta

| Behaviour | Nyte today | Decision | Why |
| --- | --- | --- | --- |
| What Enter does while running | Steer by default; the setting offers Steer or Queue [preferences/index.ts:36–40; composer.tsx:124–131] | keep | Steering is the less disruptive default, and Nyte falls back to Queue when the model cannot steer |
| Alternate submit | Swaps queue and steer; never interrupts [composer-keys.ts:35–46] | keep | Glass's default alternate stops the run, a destructive surprise behind a common chord |
| Placeholder tells what Enter does | Always "Add a follow-up" [composer.tsx:51]; only the send tooltip changes [composer-frame.tsx:174–187] | change | While running, show "Steer without stopping" or "Queue for next turn" so the user sees the mode before pressing Enter |
| Send and Stop while running | Stop always visible; Send added once there is text [composer-frame.tsx:578–605] | keep | Stop stays reachable while typing; Glass hides it behind the text |
| Esc | Menu, then edit cancel, then tray, then **stops the run** [composer-frame.tsx:503–523] | keep | A useful, documented shortcut ("Stop response (Esc)"); the precedence prevents accidental stops |
| Ctrl+C / Cmd+Shift+Backspace to stop | absent | leave out | Esc already covers it; Ctrl+C conflicts with copy expectations |
| Waiting list shown | Section with "N queued messages", always open while non-empty [composer-queue.tsx:156–162] | keep | Simpler than a chip that toggles a tray; nothing hides |
| Queue row wording | Button "Add to next response", hint "Enter to steer", row description "Enter sends now" [composer-queue.tsx:85, 160, 220] | change | One action, three names. Call it "Steer" everywhere, with tooltip "Sends without stopping the agent". |
| Interrupt from a queued row | absent | leave out | Stop then Enter on an empty composer covers it; check what Nyte does with the queue after Stop first |
| Space on a queued row | Edits [composer-queue.tsx:148] | keep | A deliberate Nyte convention; Enter already delivers |
| Reorder queued messages | absent | leave out | Needs a host operation; queues are rarely longer than two |
| Edit a queued message | Holds it on the host, restores the stashed draft, Esc cancels [composer.tsx:213–297, 552–567] | keep | Same behaviour as Glass, with a real host hold |
| Failed send | Shows the error and restores the draft, or offers "Restore Draft" if you have typed since [composer.tsx:332–353] | keep | Better than Glass, which restores silently |
| Steered message in the transcript | Faded with "Lands at the next response" until the run takes it [turn-view.tsx:328–329] | keep | Honest about delivery; Glass shows it as already delivered |
| Steer suggestion banner, first-steer toast | absent | leave out | Nyte defaults to Steer, so both would be noise |
| Drafts per chat | Persisted, including images [layout/session-view-state.ts:9, 189–251] | keep | Matches Glass |
| Prompt history | absent | add | Ctrl+Alt+Up/Down (macOS) through this chat's last 10 prompts, then back to the draft. Cheap, and users notice. |
| Type to focus | Printable keys focus the composer [screens/pane-host.tsx:27–54] | change | Also route Cmd/Ctrl+V into the composer when no field has focus |
| Down arrow jump | Scrolls to the bottom and blurs [transcript.tsx:755–757] | change | Focus the composer after the jump, as Glass does |
| Terminal chip while its list is open | Hidden [tray/terminals.tsx:107] | change | Keep the chip, show it pressed, and let it close the list |
| `@` mentions | Files, plus this conversation [composer-suggestions.tsx:476–536] | keep | Add terminals and past chats only when Nyte exposes them as references |
| `/` commands, skills, plus menu | Present [composer-frame.tsx:536–571] | keep | Same entry points; no single cross-category search is needed yet |
| Large paste chip | 10,000-character threshold, same as Glass [message-references.ts:75, 144–150] | keep | Matches |
| Model picker | Parameters first (Fast, Reasoning) with a searchable Model submenu [model-picker.tsx:140–245] | keep | Same shape |
| Model change scope | This chat only [composer-model-chip.tsx:17–32] | keep | Changing the default for new chats as a side effect surprises users; new chat has its own picker |
| Model shortcut | absent | add | Cmd/Ctrl+/ opens the picker |
| Picker close returns focus to composer | Returns to the trigger [inferred: menu default, model-picker.tsx:145] | change | Typing should resume where it was |
| New-models dot | absent | leave out | Nyte has no "new model" announcements |
| Branch in footer | Branch shown in title bar and new-chat row | add (owner decision, 2026-10-30) | Port Cursor's footer: the branch segment sits under the composer, and the title bar drops its folder/branch crumb so location shows in one place. Its menu lists branches, checks one out and creates one; with no repository the segment is absent. |
| Machine in footer | "This Mac" menu on new chat | add (owner decision, 2026-10-30) | The footer's environment segment reuses the new-chat environment menu ("This Mac", Environments…). |
| Context ring | beside Send | move | Right end of the footer, only when the host reports used/limit tokens, hover readout "N% context used". |
| Dictation | absent | leave out | A separate project: capture, permission, cancel and processing must ship together |
| Child chat composer | Editable when a child opens in a pane [screens/session-conversation.tsx:493] | keep | Add a read-only state ("Follow-ups aren't available…" in Nyte's words) only if the host refuses child input |
| Parent composer while a subagent's detail is open | Unchanged [screens/session-conversation.tsx:506–524] | add (optional) | Attach a reference to the open subagent and close its detail on send, so the follow-up reads in context |
| Proportions | See the table above | change | Radius 20, editor minimum 36, send 24, dock chip 28, tray gap 8 |

## Acceptance journeys

Desktop e2e (Electron runner). Each journey starts in a chat with a fake model that streams for at least 10 s.

1. **Queue while running.**
   1. Set Messages while running = Queue.
   2. Send "start". While it streams, type "A" and press Enter.
   3. Expect: the composer is empty, a queue section reads "1 queued message", the run keeps streaming, and the transcript has no "A".
   4. Type "B" and press Cmd+Enter.
   5. Expect: "B" appears faded in the transcript with title "Lands at the next response", and the queue still holds only "A".
   6. When the run ends, expect "A" to start a new turn on its own.

2. **Edit a queued message without losing the draft.**
   1. With "A" queued, type "draft X" in the composer.
   2. Click Edit on "A".
   3. Expect: the composer shows "A", with "Editing queued message" above it.
   4. Press Esc. Expect: the composer shows "draft X" and the row still reads "A".
   5. Edit again, change the text to "A2" and press Enter. Expect: the row reads "A2" and the composer shows "draft X".

3. **Empty Enter delivers the waiting message.**
   1. With "A" queued and the composer empty during a run, press Enter.
   2. Expect: "A" leaves the queue, appears in the transcript, and the run continues without stopping.

4. **Esc precedence.**
   1. During a run, type "@" so the suggestion menu opens, then press Esc. Expect: the menu closes and the run continues.
   2. Open the terminals tray and press Esc. Expect: the tray closes and the run continues.
   3. Press Esc again with nothing open. Expect: the stop button shows loading, then the composer returns to idle.

5. **Draft, focus and jump.**
   1. In chat 1, type "hello" and switch to chat 2.
   2. Click the transcript, press "k". Expect: the composer has focus and contains "k".
   3. Switch back to chat 1. Expect: "hello" is restored with the caret at the end.
   4. Scroll up and click the down arrow. Expect: the transcript is at the bottom and the composer has focus.

## Runtime checks still needed

1. What Stop does to waiting messages in Glass: send the first one, keep them, or clear them.
2. Which faded message the user saw. Static code says Glass does not fade queued or steered messages.
3. Glass's resting follow-up composer: compact one-row or two-row, and its measured height at 1 and 12 lines.
4. The composer's edge against the transcript text edge, and its distance from the window bottom.
5. The dock chip's radius and side padding.
6. The send-button label when the setting is stop-and-send.
7. Whether an unhandled Esc really toggles the side panel.
8. Where focus lands after closing the model picker.

The full list, written as steps to run, is in `audits/composer-audit.md`.
