# Chat shell architecture

The synthesized design for the chat shell's shared concepts. Grounded in [grounding.md](grounding.md), drawn in [logic.md](logic.md), typed in [sketch/](sketch). The three candidates it came from are in [candidates/](candidates).

## Problem

Today the shell answers chat questions from the wrong places. A chat's folder, repo and branch come from the host's one open folder, not the chat. "Is the user looking at this chat" has about ten answers, some tied to whether a component happens to be mounted. Run status is mapped nine times and the mappings disagree. Opening a chat goes through two layers with different rules, so one chat can sit in two tabs. The six feature packages added behaviour on top of that shape; this design gives each concept one owner so the next change made from one file is right for the whole app.

Hard constraints from the grounding: one host process per window with one open folder at a time; the sdk's session list and per-session view streams as the only data sources; `@nyte-ai/plugin/client/presentation`'s `executionMark` already serves the TUI and mobile and must keep its meaning; client code never imports `@nyte-ai/host`.

## Usage (caller's view)

Read chat facts from `chats`. Ask the window to complete an interaction. A caller never activates a folder, selects a pane, marks seen and restores focus as separate steps.

```ts
const chatWindow = useChatWindow().actions;

// Sidebar: plain click, Cmd-click, drop on a pane edge. No host or pane-controller calls.
await chatWindow.openChat(sessionId, { kind: "preview" });
await chatWindow.openChat(sessionId, { kind: "background" });
await chatWindow.openChat(sessionId, { kind: "split", at: focusedPane, edge: "right" });

// A subagent link. No strip-mode branch at the call site.
await chatWindow.openChat(childId, { kind: "next-to-parent", parent: parentView.id });

// Tab, sidebar row, tray, hover card: one chat, one status, one location.
const result = useChat(sessionId);
if (result.kind === "ready") renderChat(result.chat); // title, run.status, location

// Every unread indicator reads the same set.
const unread = useChatWindow().snapshot.unread.has(sessionId);

// Focus after an interaction is the window's decision.
chatWindow.act({ kind: "submitted", view: view.id });
chatWindow.act({ kind: "jump-end", view: view.id });
await chatWindow.markRead([sessionId]);
```

## Shape

**Two owners.**

- **`chats/` owns facts about a chat in any window.** One directory joins the session list, each subscribed view and the workspaces into a `Chat` per id: title with its one fallback rule, parent, per-chat location (folder, worktree, branch, machine), and one run status. Run status extends `executionMark` once: it keeps completed versus stopped versus failed, waiting for approval, and "a subagent is still working". A ready, subscribed view wins over the list entry as a unit; the list fills chats with no view.
- **`window/` owns this window.** One state holds placement (tabs, the preview slot, panes), visits, per-chat view memory and focus. One exposure projection over that state, the tray detail, the workbench cover and window focus answers "is the user looking", and its looking set gates marking read, freezing the divider boundary, suppressing unread and suppressing the finished-run toast. `openChat(id, intent)` resolves the chat's location, activates its folder, then commits placement; a failure leaves the current place alone.

**Load-bearing decisions.**

1. Looking is derived from state, never from mounting. Hidden `Activity` trees, warm sessions and pacing can't count as looking. (Opus, Sol, Astra all reached this.)
2. Status look is one pure function of status and looking: unread is dropped for a chat the user is looking at, failed counts as unread but keeps its error glyph. (Opus.)
3. One placement path. A chat appears in at most one pane per window, and every intent reveals an existing placement before it places a new one. That invariant is what lets per-chat view memory be keyed by chat id alone.
4. Archived or deleted chats leave the window by reaction to the directory, not by whichever caller archived them, so an archive from the TUI closes the tab here too. (Opus.)
5. Components register capabilities (focus the editor, scroll the transcript), never visibility decisions. No public reducer dispatch, controller lookup or wire type. (Astra.)
6. Each folder's internals are unreachable from outside: a lint rule allows imports only through `chats/index.ts` and `window/index.ts`. (Opus.)

**Interface depth.** Three read hooks (`useChat`, `useChats`, `useChatWindow`) and three commands (`openChat`, `act`, `markRead`) hide source selection, status refinement, location resolution, dedupe, preview promotion, route mirroring, visits, see ordering and focus delivery.

**Deliberately not done.** No new wire fields beyond the read mark package D added. No OS notifications. No back/forward history. No cancellation for two quick opens in different folders: the last one wins, as today.

## Synthesis decision

Sol's two-owner candidate is the base. It hides the most behaviour behind the smallest surface, and its migration order groups changes by concept so each step can be verified on its own. From Opus: the lint-enforced folder boundary, the pure status-look function, the archive reaction, and the rule that deleting the pane controller lands alone with the e2e chapters green twice. From Astra: capabilities rather than visibility decisions in components, and no public reducer. Rejected: Opus's separate `attention/` layer, because attention is status × looking and looking belongs to the window, so a third folder only re-exported the window's projection; Astra's single `ChatShell`, because one object owning chats, placement and focus becomes the place every change lands.

## Tradeoffs accepted

- We accept a larger `window/` module in exchange for one writer of placement, visits and focus.
- We accept that per-chat view memory is keyed by chat id alone in exchange for the one-placement-per-window invariant; showing one chat in two panes is not supported.
- We accept the last-wins race for two quick cross-folder opens instead of adding cancellation, per the repo rule on unlikely races.

## Alternatives considered

- **Three concept folders, `chats → window → attention`** (Opus). Clear names, but `attention/` mostly re-exported window state and added a layer to every unread read.
- **One window-owned `ChatShell` snapshot** (Astra). The smallest import surface, but it concentrates every concept in one writer and one file family.
- **Keep today's folders and add shared helpers.** Rejected: helpers beside the scattered call sites add a second way to answer each question instead of removing the first.

## Open questions and risks

- Should a search-palette pick open a preview or a permanent tab? This branch keeps permanent.
- Deleting the pane controller rewrites every placement writer at once. Does it land in this release or the next?
- "Mark as Unread" conflicts with a read mark that only moves forward. Is it wanted?

## Next implementation step

Build the chat directory with its one run status beside the existing watches, and move the sidebar row, tab, tray and hover card onto `useChat`.
