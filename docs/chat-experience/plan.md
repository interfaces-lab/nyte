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
| A1 | Persist view settings (grouping, sort, filters, Show fields), folded workspaces and revealed counts across reloads | unit test on the stored view; reload in a renderer test | done |
| A2 | Calendar buckets for the Updated grouping: Today, Yesterday, Last 7 Days, Last 30 Days, Older | unit test in sidebar-view | done |
| A3 | A Pinned section above the workspaces in grouped views; pinned chats leave their folder | unit test; renderer test | done |
| A4 | The Archived filter shows archived chats only | unit test | done |
| A5 | The open chat's row stays visible past the fold and inside a folded workspace | unit test | done |
| A6 | Fix the PR filter (every choice but "No PR" returns nothing) and make the Show fields toggles change the row | unit tests | done |
| A7 | "Mark as Read" on rows and "Mark All as Read" on workspaces | renderer or e2e test | done |
| A8 | Arrow-key navigation in the chat list (Up, Down, Home, End, Left, Right) | renderer test | done |
| A9 | Double-click a row to rename | renderer test | done |
| A10 | Confirm before archiving a chat that is working | renderer test | done |
| A11 | Copy: "No chats yet" | covered by existing tests | done |
| A12 | Proportions: row padding 6, row gap 2, 24 px hover buttons in a 52 px trailing slot with the age kept visible, default width 256 | visual check in the navigation e2e chapter | done |

### B. Composer

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| B1 | While a run is working, the placeholder names what Enter does ("Steer without stopping" or "Queue for next turn") | composer states test | done |
| B2 | One name for steering everywhere in the queue UI: "Steer", tooltip "Sends without stopping the agent" | composer queue test | done |
| B3 | Prompt history: Ctrl+Alt+Up/Down walks this chat's last 10 prompts, then returns to the draft | composer test | done, including a cold-opened long turn: the prompt leading the loaded messages counts, and walking past the loaded prompts reads older ones from history, up to 10 |
| B4 | Cmd/Ctrl+/ opens the model picker; closing it returns focus to the composer | composer test | done, in follow-up chats and on the new-chat screen: the composer frame gives its picker the shortcut and the focus return |
| B5 | Cmd/Ctrl+V with no field focused pastes into the composer | composer test | done |
| B6 | The terminal chip stays visible and pressed while its list is open, and closes it | tray test | done |
| B7 | Proportions: radius 20, editor minimum 36, send button 24, dock chip 28, tray gap 8 | composer e2e chapter | partly: radius 22 via existing token, gap 8, natural editor height; 24 px send and 28 px chip not adopted |
| B8 | Context ring, only when the host reports used and limit tokens | renderer test, or `deferred` if the host doesn't report them | done; moving to the footer (B9) |
| B9 | Footer under the composer as in Cursor: branch (menu: branches, checkout, create) and environment on the left, context ring on the right; 32 px row, 12 px tertiary text, 20 px segments; the title bar drops its folder/branch crumb | composer e2e chapter | done |

### C. Transcript content

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| C1 | Step groups show their counts while live, use the group's overall verb, and count searches ("Explored 2 files, 2 searches") | step-group presentation unit tests | done (search count deferred: no search tool kind in schema) |
| C2 | A finished turn shows one "Worked for 2m 47s" line | unit test; chat e2e assertion | done |
| C3 | Reply actions row: copy and relative time | renderer test; chat e2e assertion | done |
| C4 | Code-block copy confirmation resets after 2 s | renderer test | done |
| C5 | The inline subagent link shows a working glyph while the child runs | renderer test | done |
| C6 | Conversation proportions: column and gutters per 03-transcript.md §9 | transcript-frames renderer test stays green | done (no value change: 840 px column kept per §9) |

### D. Scrolling and unread

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| D1 | Clients receive the read mark, not only an `unread` flag | core and sdk tests; `check:store` | done (`SessionView.seenThrough`, breaking wire field; core and sdk tests; check:store clean) |
| D2 | The "New" divider sits above the first unread message on opening a chat, and stays until the chat is left | renderer test; desktop e2e | done |
| D3 | Up and down "N New Messages" pills: count, click, ×, priority, as 03-transcript.md §5.5–5.7 | renderer test; desktop e2e | removed by the owner after shipping; the New divider stays |
| D4 | Following holds within 4 px; only upward input releases it | transcript-frames renderer test | done |
| D5 | The scroll-to-bottom button focuses the composer after the jump | composer or transcript test | done |

### E. Shell and shared hover card

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| E1 | One chat hover card for sidebar rows and tabs: title, `owner/repo` and branch, `~` path, machine ("Local"), click to copy, 250 ms delay | renderer test | done |
| E2 | The "Run finished" toast appears only when the chat isn't visible in any pane | plugin or app test | done (client plugins read the window's looking set, H3) |
| E3 | The agents tray distinguishes failed from completed | unit test | done |
| E4 | Right panel defaults to 50 % with a 384 px minimum, stored as a ratio | controller unit test | done |
| E5 | The Changes rail entry shows `+N −N` line totals | renderer test | done |

### F. Tabs

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| F1 | One preview slot per window: a plain sidebar click opens the chat in an italic preview tab that the next plain click replaces | tabs model tests; navigation e2e | done |
| F2 | A preview becomes permanent on double-click, sending a message, dragging, splitting, or "Keep Open" | tabs model tests; `chat/composer/preview-send.test.ts` | done |
| F3 | Opening a subagent opens a preview tab next to its parent instead of replacing the parent | navigation or subagents e2e | done |
| F4 | Previews are dropped on restart and a replaced preview isn't offered by reopen-closed-tab | tabs model tests | done |
| F5 | Tabs size to their content up to 280 px; the strip fades at its edges | tab strip test | done |
| F6 | Delete closes the focused tab | tab strip test | done |

### Deferred

| Item | Why it waits |
| --- | --- |
| Legend List migration | Not needed for these rules; two e2e chapters still fail on it |
| Disk height cache, pretext measurement | Restore problems come from anchoring, not estimates; revisit after D measures reflow |
| Code citation card | Needs a reference format from the model output first |
| Back/forward history, compact rail, OS notifications | Separate desktop work; none blocks the chat experience |
| Workspace drag-to-reorder, stale workspace folding | Need A1 first |
| Reply fork, dictation, queue reorder | Need host operations or a separate project |

## Architecture

The goal is a faithful port of Glass's behaviour and practices, with clearer logic and file structure than Nyte has today, not a pixel replica. The six packages add behaviour; this track makes the shell's shared concepts (chat identity, run status, read state, visibility, opening a chat, focus) each have one owner that every surface reads. It follows the architect workflow; outputs live in [architecture/](architecture).

| Phase | Output | Status |
| --- | --- | --- |
| Ground | `architecture/grounding.md`: traced model of today's shell with file:line | done |
| Sketch | Three candidate designs from different models, screened against the red flags | done (`architecture/candidates/`) |
| Synthesize | `architecture/rationale.md` and the type sketch: module map, types, signatures | done: Sol base, Opus and Astra grafts |
| Implement | H1–H3 below, on `chat-experience` after the six packages merge | done |
| Scrap check | Record whether implementation fought the sketch, and the redesign if so | done: no scrap; deviations below |

### H. Architecture (this branch)

| ID | Item | Proven by | Status |
| --- | --- | --- | --- |
| H1 | One chat directory: a `Chat` per id with title, parent, location and run status, joined once from the session list, views and workspaces; folder boundary enforced by lint | unit tests on the directory; existing renderer and e2e suites | done |
| H2 | One run status every surface reads (sidebar row, tab, tray, composer, announcer, toast); the per-surface mappings are deleted. Stopped, failed, completed and approval stay distinct | unit tests on the status refinement; agents tray and sidebar tests | done |
| H3 | One "looking" projection over window state, tray detail, workbench cover and window focus; it gates marking read, the divider boundary, unread suppression and the finished-run toast (completes E2 for split panes) | unit tests on the projection; transcript unread and notification tests | done |

Deviations from the sketch, kept for the next branch to weigh:

- `RunStatus` lives in `@nyte-ai/plugin/client/presentation` beside `executionMark`, not in `chats/`, because the run toast is a plugin and can't import the app. It is one union whose active kinds carry their run, so `OwnRun` and `ChatRun` collapsed into it; `retrying` is its own kind to keep its glyph. The composer and announcer read the open view's own run (`runStatus(view.execution)`), the sketch's `run.self`; every other surface reads `Chat.status`.
- `Chat` has no `pinned`, `archived` or timestamps yet: no surface reads them from it. `ChatLocation` has no machine or repository: the hover card still enriches git and GitHub per workspace, and its machine line comes from the client surface.
- `ChatResult` has no `failed` kind; a list that fails to load stays `loading`.
- `useChats` and `useChatWindow` take a selector, so a row re-renders only when its own answer changes.
- The window's looking projection reads today's window tabs, the tray's open agent (moved into the window store, keyed by parent chat), the workbench, settings and focus. The toast filter stays in the notifications plugin; the plugin api gained `looking` instead of the sketch's app-only completion plugin.

### Next branch

| Item | Why it waits |
| --- | --- |
| Replace the pane controller and window tabs with one window state; every placement writer through `openChat` | Rewrites every placement writer at once; it lands alone with the e2e chapters green twice (rationale.md) |
| Per-chat folder for file, git and workbench inputs | Changes every file-tool consumer; independent of H1–H3 |
| Window-owned focus requests; move thin views into `ui/` | Follow the window state |

## Audit round 2: the whole app

A code-only review of the whole desktop app. Reviewers get a snapshot of this branch with every Markdown file removed, so their judgement rests on code alone. Each area has two reviewers on different models (Opus 5.5 high, GPT-6.1 Sol xhigh); findings both reach count as confirmed, the rest are checked in code before they become work.

| Area | Question | Status |
| --- | --- | --- |
| Structure | Can a newcomer navigate `packages/app/src` and `packages/desktop/src`? Folder map, oversized files and folders, import graph | reviewed → P1 |
| Linkage | How subagents, background jobs and terminals connect to their owner chat across every surface | reviewed → P4 |
| Tokens | Do type, spacing, size, radius, colour, elevation and motion form clean levels, used consistently? | reviewed → P6 |
| Workbench | Model versus view in `workbench/`; the rail's overlapping launchers and open tabs | reviewed → P5 |
| Rendering | How files open and render; images stuck at "Opening file…" | reviewed → P3 |
| Run-state gate | Desktop and TUI say "Working…" when only background subagents run; a chat whose own run ended must read as done and take a new message at once | reviewed → P2 |

Findings, decisions and the packages they became: [audit/README.md](audit/README.md).

## Map

What each package may break, and what it must not touch.

- **A Sidebar.** Owns `packages/app/src/chrome/sidebar*`, `use-sidebar.ts`, `session-actions.ts` (archive confirm), and the sidebar e2e chapter. Shared state: the view store (`layout/session-view-state.ts`) and preferences. Does not touch the hover card body; E owns it.
- **B Composer.** Owns `packages/app/src/conversation/composer*`, `model-picker*`, `tray/terminals.tsx`, `screens/pane-host.tsx` (paste routing). Shared: keyboard shortcuts in `client-actions.ts`; check for collisions before adding Cmd/Ctrl+/.
- **C Transcript content.** Owns `step-group*`, `transcript-presentation.ts`, `turn-view.tsx` (actions row), `code-block.tsx`, `subagent-call.tsx`, and the conversation tokens in `theme/`. Shared with D: `transcript-rows.ts`; C adds no row kinds.
- **D Scrolling and unread.** Owns `transcript.tsx`, `transcript-scroll.ts`, `transcript-mode.ts`, row kinds in `transcript-rows.ts`, and the read-mark path through `packages/schema`, `packages/core` and `packages/sdk`. Widest blast radius: a wire shape change reaches every client (TUI, mobile, web). Additive fields only; run `check:store`.
- **E Shell.** Owns the shared hover card (new component used by `chrome/sidebar-rows.tsx` and `tabs/window-tab-strip.tsx`), `packages/plugin/src/client/notifications.ts`, `conversation/agent-status.ts`, `workbench/controller.ts`, `workbench/rail-status.tsx`.
- **F Tabs.** Owns `packages/app/src/tabs/` except the hover card wiring, and the call sites that open sessions (`screens/session-conversation.tsx` child opening, sidebar click handler). Shared: `layout/pane-*` for split promotion.
