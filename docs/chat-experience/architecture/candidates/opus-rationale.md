# Rationale: three concept owners for the chat shell (opus candidate)

## Problem

The shell's shared concepts have no owners. Grounding counts about ten answers to "is the user looking at this chat" (§4), nine run-status mappings that disagree on stopped, failed and waiting (§2), six title fallbacks (§1), a read check on `heads[0]` while the mark is written on `main` (§3), and two layers of "open a chat" with different dedupe, folder and router rules (§5). Each builder branch fixes its own item and adds one more local answer. chat-shell's toast guard uses the plugin's one-chat focus and misses a split. chat-unread's visit relies on effect cleanup under hidden `Activity`. chat-shell's card reads git and GitHub inline. Constraints carried over from grounding:

- The host has one open folder per connection.
- The read mark moves forward only, and only on an explicit `see` (faebe7391).
- The run vocabulary lives in `@nyte-ai/plugin/client/presentation` so the TUI and mobile stay aligned (278303529).
- The plugin learns about the app only through `mountClientPlugins`.
- A folder that hasn't loaded must never read as Home (86a05de23).
- Tabs own the place and the route is adopted.
- Writes stay off the keystroke path.
- Storage keys are user data.

## Usage (caller's view)

Surfaces import from three concept folders. Each folder has one `index.ts`; everything else in it is private.

```ts
import { useChat, statusLook, useFolderRepository } from "../chats/index.ts";   // facts about a chat
import { openChat, keepOpen, useLooking, focusComposer, usePaneSpot } from "../window/index.ts"; // this window
import { useChatLook, ReadMark, deliverNotice, useUnread } from "../attention/index.ts";        // seen / unseen
```

**Sidebar click.** Today: `showSession`, `sidebar.tsx:81-93`. It awaits `activateWorkspace`, then either `windowTabs.dispatch` or `shellActions.showWorkspace()` plus `controller.drop`.

```tsx
<Row
  onClick={(event) => void openChat(chat.id, modified(event) ? "background" : "preview")}
  onAuxClick={(event) => event.button === 1 && void openChat(chat.id, "background")}
/>
<Menu.Item onClick={() => void openChat(chat.id, { beside: "right" })}>Open Chat to the Side</Menu.Item>
```

`showSession` is deleted. Folder activation, the abort when it fails, dedupe, the preview slot and focus all happen inside `openChat`.

**Subagent "open as full chat".** Today: `session-conversation.tsx:510-513`. `paneActions.openSessionInPane(paneId, child)` replaces the parent in its pane and doesn't dedupe.

```tsx
onExpand={(child) => { setTray({ kind: "closed" }); void openChat(child, "preview"); }}
```

The reducer reads `parent` from the directory, so the preview lands right after the parent's tab (F3). Without a strip (web), the chat tab shows it, as today.

**"Back to parent chat".** Today: `titlebar.tsx:87-102`. A plain click calls `panes.openSession`, with no dedupe and no folder change. A modified click goes through the route.

```tsx
onClick={(event) => { if (modified(event)) return; event.preventDefault(); void openChat(parent, "permanent"); }}
```

**Window tab item.** Today: `use-window-tabs.tsx:113-186`. It reads roots only, so a subagent tab shows "Chat" with no glyph. The unread dot is hidden on the active tab even when the window is unfocused.

```tsx
const title = useChat(id, (chat) => chat.title);
const look = useChatLook(id);           // statusLook(chat.status, useLooking(id))
// glyph: look.glyph, aria label: `${title}, ${look.label}`, unread dot: look.unread
```

**Seen marking.** Today: `MarkSeen`/`SeeTip` with its own focus and workbench-cover reads, `session-conversation.tsx:250-296`.

```tsx
<ReadMark chat={sessionId} />           // sees the main tip while useLooking(sessionId)
```

**Run toast.** Today: `client-plugins.tsx:34-39` and chat-shell's `api.session?.id === event.session`.

```ts
mountClientPlugins({ ..., notify: deliverNotice });   // drops notices about chats in screen.shown
// notifications.ts: api.ui.notify({ session: event.session, title, message: "Run finished", level: "info" })
```

**Composer.** Today: `composer.tsx:140`, `:656-662`. Any non-idle run shows the floating "working" dot, including a run waiting for approval.

```ts
const run = runState(execution);                       // the same vocabulary the list uses
const busy = run === "working" || run === "waiting" || run === "retrying";
// floating dot only when run === "working"; on submit: keepOpen(sessionId) (F2)
```

**Scroll-to-bottom and pills (D5).** Today the transcript takes a `focusComposer` prop that chat-unread threads through.

```ts
const spot = usePaneSpot();
onJump={() => { controls.end(); focusComposer(spot); }}
```

**Hover card** (chat-shell's `ChatBlock`, `chat-card.tsx:84-100`):

```tsx
const chat = useChat(sessionId);
const repository = useFolderRepository(chat?.folder ?? null);
const card = chat == null ? null : chatCardFacts(chat, repository);   // pure; no git or GitHub reads inline
```

## Shape

**Data structures first.**

- `Chat` (`chats/chat.ts`): `title` with the one fallback rule, `named`, `parent`, `folder: ChatFolder | null`, `status: ChatStatus`, `tip`, `pinned` and `archived`. `ChatFolder` is per chat: the path tools run in, the name, the worktree with its source folder and branch, and the machine.
- `ChatStatus`: `run: RunState`, `delegating`, `unread` and `notice`.
- `ChatDirectory` is built once per `sessionsWatch("all")` frame plus the workspace list plus the optimistic projection. It covers children.
- `WindowState` (`window/tabs.ts`) gains `preview: TabId | null`. That is one slot by type.
- `Screen` (`window/screen.ts`) is `shown: Set<SessionId>`, `covered`, `attended` and `focused`.
- `FocusRequest` is `{ spot, serial }`, one per window.
- `ChatViewState` is keyed by chat id.

**Dominant access patterns:**

| Access | Path |
| --- | --- |
| Sidebar rows | `useChats(roots)` |
| Tab strip | `useChat(id)` and `useChatLook(id)` for N ids, children included |
| Agents tray | `children(id)` |
| Card | `useChat` and `useFolderRepository(folder)` |
| Open | `readChat(id)` for folder and parent, then `reduce` |
| Notice | `screen.get().shown.has(id)` |
| Read mark | `useLooking(id)` |

None of them needs a later index.

**Load-bearing decisions.**

1. **Three concept folders with one import direction:** `chats/` → `window/` → `attention/`. Surfaces sit above all three.
   - `chats/` is what is true about a chat in any window.
   - `window/` holds this window's places, what is on screen, where the keyboard goes and what the window remembers.
   - `attention/` is the meeting point: status × looking, the read mark, notices and the unread visit.

   No concept folder imports a surface. A lint rule makes each folder's files except `index.ts` unreachable from outside, with one allow-listed edge: `window/chat-commands.ts` → `chats/actions.ts`.
2. **Visibility is derived from state, never from mounting.** `deriveScreen` is pure over:
   - the window state (pane tab, a page in front);
   - the tray views, which move from component state into `window/trays.ts`;
   - the workbench cover;
   - window focus.

   Hidden `Activity`, hot sets and warming can't count as "looking". `useVisit` gives the transcript an explicit visit boundary in place of effect cleanup.
3. **One run vocabulary, extended in the plugin package.** `runState` returns seven states, and `executionMark` becomes a collapse of it, so the TUI and mobile don't change. The list stream answers "how does the chat look" and the view stream answers "what do this chat's controls do". Both go through `runState`.
4. **Unread is suppressed by looking, in one function.** `statusLook(status, looking)` drops unread for a displayed chat, which is Glass's rule. That replaces the tab's "not the active tab" rule. An unfocused window's active tab then shows unread like its sidebar row does. Failed runs count as unread too (01-sidebar.md), but they keep the error glyph.
5. **One placement path, with intents instead of layers.**
   - `openChat(chat, "preview" | "permanent" | "background" | { beside })`. "Next to the parent" is derived from `parent`, not passed in.
   - Invariant, enforced in `reduce`: a chat appears in at most one pane per window, and every intent reveals before it places.
   - That invariant is why per-chat view state can be keyed by chat id alone. It also deletes per-pane scroll and makes the tray key unambiguous.
   - Foreground opens switch the host folder first and abort if that fails. This is today's sidebar rule, now applied to every caller.
6. **Archived or deleted chats leave the window by reaction, not by caller.** The store watches the directory and dispatches `chats-gone`, so an archive from the TUI closes the tab here too. Reopen skips them.
7. **PaneController is deleted.** Layout ops become window actions. Focus becomes one serial. Split memory per chat and `ComposerViewState.focused` are dropped: written, never needed.

**Validation and invariants.**

- Wire types stop at `chats/directory.ts`.
- "Not loaded" can't read as Home because no `Chat` exists until both lists load: `useChats` is `undefined` until then.
- One preview is a type, not a check.
- "Shown once per window" is a reducer invariant, with `findChat` as its single answer.

**What it deliberately does not do:**

- No wire change beyond chat-unread's `seenThrough`. Repo and branch are a client lookup keyed by workspace.
- No OS notifications. `deliverNotice` is where they would go.
- No back/forward history.
- No unified keydown router.
- No cancellation for overlapping cross-folder opens.

**Interface depth.**

| Folder | Public surface |
| --- | --- |
| `chats/` | 6 entries |
| `window/` | ~20: one placement family (`openChat`, `openPage`, `newChat`, `showDraft`, `startChat`, `keepOpen`), tab commands, layout ops, five screen predicates, tray, focus, view state, route sync |
| `attention/` | 7 entries |

Behind them sit:

- Session projection, the descendant pass, folder and worktree resolution, the title rule, readiness of two lists, object reuse across frames, and the unlisted fallback.
- Dedupe, the preview slot, parent placement, the blank-tab rule, "here", folder ordering and abort, focus issuing, persistence without the preview, reopen skips, and the `chats-gone` reaction.
- Pane tab and page rules, tray children, cover, focus events, visit serials, and pacing.

The widest piece is `window/`. Its five screen predicates are deliberate: a named `useLooking` keeps call sites from rebuilding "shown && attended" with one input missing.

## Synthesis decision

Not filled in: this is one runner's candidate. For synthesis:

- The parts most worth grafting on their own are the "shown once per window" invariant, `chats-gone` by reaction, the tray state move, and `useVisit`.
- The part most worth challenging is deleting PaneController in the same track.

## Tradeoffs accepted

- **Startup timing.** The directory waits for both the session list and the workspace list, which may cost a few ms on first paint before workspaces land. In return, nobody can read "loading" as Home.
- **Slower foreground opens.** Every foreground open waits for the host folder switch when the folder differs, including palette and route opens that are instant today. In return, the folder abort rule holds for every caller, and a chat never lands in a tab with the wrong folder open.
- **Drop onto a pane reveals.** Dropping a chat that is already in another tab reveals that tab instead of duplicating it or moving it. In return, one invariant replaces every special case.
- **Tray state moves into the window store.** It was component state. In return, visibility can be derived instead of registered.
- **Sidebar lists ignore looking.** Pure sidebar list functions (shelves, sort) call `statusLook(..., false)` and keep the shelf hold. In return, list derivation stays free of window state. The row glyph still uses `useChatLook`.
- **cwd changes in splits.** The transcript and composer resolve paths against the chat's own folder, while the workbench follows the host folder (the focused pane's chat). Two panes from different folders now resolve their own paths, and the workbench follows focus as today.
- **An extra field on plugin notices.** The plugin API gains an optional `session` on notify. In return, the app owns delivery and toasts can open their chat.

## Alternatives considered

- **A view model per surface:** `useSidebarRowModel`, `useTabModel`, `useCardModel`, each composing raw streams. This is today's shape with better names. Every model re-maps status and re-decides visibility, which is the hand-synced list again. The public surface is wide and hides nothing shared.
- **Have the host compute delegating, looking and unread-as-shown.** Visibility is per window and per pane, so the host can't know it without a presence protocol. It would also be a wire change for every client. This hides the most behind the smallest surface, but in the wrong place.
- **Visibility by registration:** each drawn conversation registers itself as shown. This is smaller to build, but it is exactly the mount-semantics dependency grounding §4 warns about. The text pacing counter (`sdk.tsx:479-490`) already shows the shape.
- **One app-wide store holding chats, window and attention.** Chats are the same across windows and window state isn't. A single store blurs who writes what and makes every surface subscribe to everything.

## Red-flag screen

| Flag | Result |
| --- | --- |
| Shallow module | `openChat` is one call hiding six rules. `tabCommands` is thin; it stays because reopen's archived skip is computed there from the directory. `useChatLook` is a two-line composition kept as the only place status meets looking. |
| Information leakage | `SessionInfo`/`WorkspaceInfo` stop at `chats/directory.ts`. Until chat-sidebar's `sidebar-view.ts` migrates to `Chat`, it still reads `SessionInfo`: a known, temporary leak. `RunState` is shared on purpose. |
| Temporal decomposition | None. Modules group by the decisions they protect. `open.ts` holds both the folder switch and the dispatch. |
| Pass-through | `keyOwner` moves, it isn't wrapped. `route-sync` adds the adoption policy. None found. |
| Split ownership | Fixed: tray view (now `trays.ts`), read mark (`attention/read-mark.tsx` is the only `see` caller), host folder (`host-folder.ts`), focus (one serial), pane layout (one reducer). Remaining: the workbench cover belongs to `workbench/controller.ts` and screen only reads it. |
| Two ways to do one task | Opening: one way; `PaneActions.openSession`/`openSessionInPane`/`drop`/`openDraftChat` are deleted. Archive: one way, enforced by the allow-list. Status: `statusLook` for looks and `runState` for controls. Those are two inputs to one vocabulary, stated as a rule. |
| Importable internals | Lint `no-restricted-imports` patterns per concept folder. Risk: oxlint's support for negated patterns needs checking (open question). |
| Hand-synced list | Title fallback: one. `StatusGlyph` → `StatusDot` drawing: `satisfies Record<StatusGlyph, …>`. Storage keys unchanged. Focus rules sit in one store function, not per caller. |

`tsc` passes on the sketch against the real `node_modules`. The repo's oxlint reports only unused stub parameters and the header comments on sketch files.

## Open questions and risks

1. Should a search-palette pick open a preview, like a sidebar click, or a permanent tab? The sketch says permanent.
2. Should `permanent` promote a preview that already shows the chat? The sketch says yes; Glass's rule 1 doesn't promote on reveal.
3. Is a child in a parent's tray detail "looked at" for read marking and toasts? Today it is, and the sketch keeps that. Glass is unverified.
4. Does the first paint have a workspaces snapshot? If not, does waiting for both lists delay rows visibly?
5. Two quick opens in different folders: the existing chain makes the last activation win, with no cancel token. Is that acceptable? The race needs a click while a folder switch is pending, and each switch is a local host call of a few ms.
6. Can oxlint's `no-restricted-imports` express "everything in `chats/` except `index.ts`, and allow `window/chat-commands.ts`"? If not, a small JS plugin in `packages/app/lint` is needed.
7. Does anything rely on per-chat split restore (`pane-controller.ts:113-121`)? The sketch deletes it.
8. "Mark as Unread" moves the mark backward, against faebe7391's forward-only rule. Is it in scope at all?
9. Riskiest step: deleting PaneController (module-map step 7). It touches every pane surface, draft promotion and focus. It should land alone, with the navigation, composer and chat e2e chapters run twice.

## Next implementation step

Add `runState` to the plugin presentation module, build `chats/directory.ts` and `statusLook`, and move the tab strip's items onto `useChat`. That deletes `session-activity.ts` and `session-read-state.ts`, and subagent tabs get a real title and glyph.
