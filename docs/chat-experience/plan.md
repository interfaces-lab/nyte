# Plan: chat experience for v0.0.25

The specs in this folder say what Cursor Glass does. This plan says what Nyte builds from them in this release, who builds it, how each item is proven, and what waits.

## Goals

1. **The chat feels like one product.** Sidebar, composer and transcript follow the rules in the specs, with Glass's proportions mapped onto Nyte's theme tokens.
2. **Nothing new happens out of sight.** A user who scrolled up, switched chats or looked away can see what arrived and get back to it: the "New" divider, the new-message pills, unread rows, and a finished-run toast only when the chat isn't visible.
3. **Typing always goes where the user expects.** The composer names what Enter will do in every state.
4. **Every item is proven through the real app.** Each item names its test, and the whole branch passes the definition of done below.

## Decisions

- **The list engine stays TanStack Virtual.** Glass's chat doesn't use a list library; its behaviour lives in its own rules (03-transcript.md, Engine recommendation). Nyte builds those rules as its own logic over the current engine. The Legend List migration (branch `legend-transcript`) is not merged: two desktop e2e chapters still fail on it, and its 360-line patch sits exactly where these rules live.
- **Proportions come from Glass, values from Nyte's theme.** Widths, radii and gaps are set through `packages/app/src/theme` and `packages/ui/src/styles` tokens, never as literals in components.
- **Cursor-cloud features are left out:** automations, cloud upsells, "Multiple local agents" toast, machine switching, "IDE ↗".
- **Approval notifications are out of this release.** Approving a command from a banner is a security decision that needs the user's sign-off (04-shell.md).

## Definition of done

- Every in-scope item below is `done`, with its test passing.
- `pnpm check` passes (format, lint, typecheck).
- `pnpm --dir packages/app test` passes, including the electron renderer tests.
- `pnpm --dir packages/host check:store` passes if any stored or wire shape changed.
- Desktop builds without `--warn-budgets`, and these e2e chapters pass twice in a row with `--retries=0`: composer, chat, chat-rendering, transcript, navigation, subagents, workbench.
- A principle review of the whole branch diff has no open design findings.

## Work packages

Each package is built in its own worktree off `chat-experience` and merged back. Packages own disjoint files where possible; the map lists what each one may touch and what it must not.

| Package | Worktree branch | Spec |
| --- | --- | --- |
| A. Sidebar | `chat-sidebar` | 01-sidebar.md |
| B. Composer | `chat-composer` | 02-composer.md |
| C. Transcript content | `chat-blocks` | 03-transcript.md §6, §7, §9 |
| D. Scrolling and unread | `chat-unread` | 03-transcript.md §3, §5 |
| E. Shell and shared hover card | `chat-shell` | 04-shell.md §3–5, 01-sidebar.md hover card |
| F. Tabs | `chat-tabs` | 04-shell.md §2 |

## Items

Status: `todo`, `doing`, `done`, `deferred`.

### A. Sidebar

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| A1 | Persist view settings (grouping, sort, filters, Show fields), folded workspaces and revealed counts across reloads | unit test on the stored view; reload in a renderer test | todo |
| A2 | Calendar buckets for the Updated grouping: Today, Yesterday, Last 7 Days, Last 30 Days, Older | unit test in sidebar-view | todo |
| A3 | A Pinned section above the workspaces in grouped views; pinned chats leave their folder | unit test; renderer test | todo |
| A4 | The Archived filter shows archived chats only | unit test | todo |
| A5 | The open chat's row stays visible past the fold and inside a folded workspace | unit test | todo |
| A6 | Fix the PR filter (every choice but "No PR" returns nothing) and make the Show fields toggles change the row | unit tests | todo |
| A7 | "Mark as Read" on rows and "Mark All as Read" on workspaces | renderer or e2e test | todo |
| A8 | Arrow-key navigation in the chat list (Up, Down, Home, End, Left, Right) | renderer test | todo |
| A9 | Double-click a row to rename | renderer test | todo |
| A10 | Confirm before archiving a chat that is working | renderer test | todo |
| A11 | Copy: "No chats yet" | covered by existing tests | todo |
| A12 | Proportions: row padding 6, row gap 2, 24 px hover buttons in a 52 px trailing slot with the age kept visible, default width 256 | visual check in the navigation e2e chapter | todo |

### B. Composer

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| B1 | While a run is working, the placeholder names what Enter does ("Steer without stopping" or "Queue for next turn") | composer states test | todo |
| B2 | One name for steering everywhere in the queue UI: "Steer", tooltip "Sends without stopping the agent" | composer queue test | todo |
| B3 | Prompt history: Ctrl+Alt+Up/Down walks this chat's last 10 prompts, then returns to the draft | composer test | todo |
| B4 | Cmd/Ctrl+/ opens the model picker; closing it returns focus to the composer | composer test | todo |
| B5 | Cmd/Ctrl+V with no field focused pastes into the composer | composer test | todo |
| B6 | The terminal chip stays visible and pressed while its list is open, and closes it | tray test | todo |
| B7 | Proportions: radius 20, editor minimum 36, send button 24, dock chip 28, tray gap 8 | composer e2e chapter | todo |
| B8 | Context ring, only when the host reports used and limit tokens | renderer test, or `deferred` if the host doesn't report them | todo |

### C. Transcript content

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| C1 | Step groups show their counts while live, use the group's overall verb, and count searches ("Explored 2 files, 2 searches") | step-group presentation unit tests | todo |
| C2 | A finished turn shows one "Worked for 2m 47s" line | unit test; chat e2e assertion | todo |
| C3 | Reply actions row: copy and relative time | renderer test; chat e2e assertion | todo |
| C4 | Code-block copy confirmation resets after 2 s | renderer test | todo |
| C5 | The inline subagent link shows a working glyph while the child runs | renderer test | todo |
| C6 | Conversation proportions: column and gutters per 03-transcript.md §9 | transcript-frames renderer test stays green | todo |

### D. Scrolling and unread

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| D1 | Clients receive the read mark, not only an `unread` flag | core and sdk tests; `check:store` | todo |
| D2 | The "New" divider sits above the first unread message on opening a chat, and stays until the chat is left | renderer test; desktop e2e | todo |
| D3 | Up and down "N New Messages" pills: count, click, ×, priority, as 03-transcript.md §5.5–5.7 | renderer test; desktop e2e | todo |
| D4 | Following holds within 4 px; only upward input releases it | transcript-frames renderer test | todo |
| D5 | The scroll-to-bottom button focuses the composer after the jump | composer or transcript test | todo |

### E. Shell and shared hover card

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| E1 | One chat hover card for sidebar rows and tabs: title, `owner/repo` and branch, `~` path, machine ("Local"), click to copy, 250 ms delay | renderer test | todo |
| E2 | The "Run finished" toast appears only when the chat isn't visible in any pane | plugin or app test | todo |
| E3 | The agents tray distinguishes failed from completed | unit test | todo |
| E4 | Right panel defaults to 50 % with a 384 px minimum, stored as a ratio | controller unit test | todo |
| E5 | The Changes rail entry shows `+N −N` line totals | renderer test | todo |

### F. Tabs

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| F1 | One preview slot per window: a plain sidebar click opens the chat in an italic preview tab that the next plain click replaces | tabs model tests; navigation e2e | todo |
| F2 | A preview becomes permanent on double-click, sending a message, dragging, splitting, or "Keep Open" | tabs model tests | todo |
| F3 | Opening a subagent opens a preview tab next to its parent instead of replacing the parent | navigation or subagents e2e | todo |
| F4 | Previews are dropped on restart and a replaced preview isn't offered by reopen-closed-tab | tabs model tests | todo |
| F5 | Tabs size to their content up to 280 px; the strip fades at its edges | tab strip test | todo |
| F6 | Delete closes the focused tab | tab strip test | todo |

### Deferred

| Item | Why it waits |
| --- | --- |
| Legend List migration | Not needed for these rules; two e2e chapters still fail on it |
| Disk height cache, pretext measurement | Restore problems come from anchoring, not estimates; revisit after D measures reflow |
| Code citation card | Needs a reference format from the model output first |
| Back/forward history, compact rail, OS notifications | Separate desktop work; none blocks the chat experience |
| Workspace drag-to-reorder, stale workspace folding | Need A1 first |
| Reply fork, dictation, queue reorder | Need host operations or a separate project |

## Map

What each package may break, and what it must not touch.

- **A Sidebar.** Owns `packages/app/src/chrome/sidebar*`, `use-sidebar.ts`, `session-actions.ts` (archive confirm), and the sidebar e2e chapter. Shared state: the view store (`layout/session-view-state.ts`) and preferences. Does not touch the hover card body; E owns it.
- **B Composer.** Owns `packages/app/src/conversation/composer*`, `model-picker*`, `tray/terminals.tsx`, `screens/pane-host.tsx` (paste routing). Shared: keyboard shortcuts in `client-actions.ts`; check for collisions before adding Cmd/Ctrl+/.
- **C Transcript content.** Owns `step-group*`, `transcript-presentation.ts`, `turn-view.tsx` (actions row), `code-block.tsx`, `subagent-call.tsx`, and the conversation tokens in `theme/`. Shared with D: `transcript-rows.ts`; C adds no row kinds.
- **D Scrolling and unread.** Owns `transcript.tsx`, `transcript-scroll.ts`, `transcript-mode.ts`, row kinds in `transcript-rows.ts`, and the read-mark path through `packages/schema`, `packages/core` and `packages/sdk`. Widest blast radius: a wire shape change reaches every client (TUI, mobile, web). Additive fields only; run `check:store`.
- **E Shell.** Owns the shared hover card (new component used by `chrome/sidebar-rows.tsx` and `tabs/window-tab-strip.tsx`), `packages/plugin/src/client/notifications.ts`, `conversation/agent-status.ts`, `workbench/controller.ts`, `workbench/rail-status.tsx`.
- **F Tabs.** Owns `packages/app/src/tabs/` except the hover card wiring, and the call sites that open sessions (`screens/session-conversation.tsx` child opening, sidebar click handler). Shared: `layout/pane-*` for split promotion.
