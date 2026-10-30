## Usage (caller's view)

Read chat facts from `chats`. Ask the window to complete an interaction. A caller never activates a folder, selects a pane, marks seen and restores focus separately.

```ts
import { useChat, useChatWindow } from "../ui/chat-bindings.ts";
const chatWindow = useChatWindow().actions;

// chrome/sidebar.tsx:81-93,405-411. No host or controller calls.
await chatWindow.openChat(sessionId, { kind: "preview" });
await chatWindow.openChat(sessionId, { kind: "background" });
await chatWindow.openChat(sessionId, { kind: "split", at: focusedPane, edge: "right" });
await chatWindow.openChat(sessionId, { kind: "permanent" }); // Search result.

// screens/session-conversation.tsx:510-514. No strip-mode branch.
await chatWindow.openChat(childId, { kind: "next-to-parent", parent: parentView.id });

// tabs/use-window-tabs.tsx:137-189; chat-shell components/chat-card.tsx:84-110.
const result = useChat(sessionId);
if (result.kind === "ready") renderChat(result.chat); // title, run.status, location.
// All unread indicators use useChatWindow().snapshot.unread.has(sessionId).

// Composer's existing onLeave, transcript jump and model-picker close callbacks.
chatWindow.act({ kind: "submitted", view: view.id });
chatWindow.act({ kind: "jump-end", view: view.id });
chatWindow.act({ kind: "picker-closed", view: view.id });
await chatWindow.markRead([sessionId]);
```

Usage was written before the types. `sketch/usage.ts` checks these caller shapes against the installed SDK types.

## Problem

Today's shell treats the host folder, active tab and mounted conversation as answers to chat questions. Six builders add behavior without consolidating that ownership. Hard constraints remain one host folder per connection, tabs owning routes, explicit forward-only see, watches never implying reading, children requiring the all-session list, and plugin presentation supplying the shared execution vocabulary.

## Shape

Two owners, not seven services. `chats` owns connection facts, indexed by session, parent and workspace. `window` owns the placement tree, visits, drafts/view memory and focus. Components render projections and send semantic actions. Internal functions are not independently writable stores.

A ready subscribed unpaced view wins over the all-session list as a unit. Direct info fills missing list entries only. `executionMark` supplies base classification; one refinement retains completed/stopped outcomes and descendant work. `run.self` controls Stop; `run.status` describes the whole chat. An idle parent with working children has no invented local Stop target. Location joins the chat's workspace, never the host default folder. Worktree source is grouping metadata, not cwd.

One exposure projection handles active tab, both panes, window focus/visibility, full covers and tray detail. Its looking set gates see, boundary freezing, unread suppression and completion toasts. Shown-but-unfocused is only a pacing distinction. Capture a visit's baseline before issuing see. Blur/cover freezes it; leaving ends it. Arrival identity sets count first visible messages, not streaming chunks. Core alone persists the read mark. D1's `seenThrough` is sufficient; no additional wire work is proposed.

`openChat` resolves location, activates the folder, then commits placement. Failure leaves the current destination alone. Background skips activation/focus/reading. Delete PaneController and its tab synchronization loop. Ordinary opens reveal existing placements; explicit split/drop moves one instead of duplicating its editor. One optional preview value cannot contain splits or enter saved-tab types.

Interface depth is high relative to its public size. Three read hooks and `openChat`, `act`, `markRead` hide source selection, capabilities, dedupe, promotion, route mirroring, visits, see ordering and focus delivery. Draft editing has one narrow binding. Opaque SDK IDs cross the interface; wire records, DOM objects and storage schemas do not. Detailed policies, state keys and migration steps are in `module-map.md`.

## Synthesis decision

Independent candidate; no other runner's design was read. Recommend it as a base when deleting the dual placement model matters more than preserving today's class boundaries.

## Tradeoffs accepted

- We accept a larger window model in exchange for deleting mutually synchronized tab/pane controllers.
- We accept fixed view-over-list precedence and possible brief fallback regression in exchange for no invented ordering protocol.
- We accept one editable placement per chat/window in exchange for one draft and predictable focus. Tray detail remains another reader.
- We accept missing metadata staying unknown in exchange for no guessed remote machine or home path.

## Alternatives considered

- Seven concept services plus a coordinator exposes ordering among visibility, visits, see, placement and focus. More APIs hide less behavior.
- A global event store hides operations but mixes connection facts, window lifetimes and DOM events behind a universal action protocol.
- A forwarding openChat method over existing controllers hides almost nothing and leaves drop/draft/parent-link bypasses intact.

## Red-flag screen

| Flag | Result |
| --- | --- |
| Shallow module | Pass. One open completes folder, placement and focus policy. |
| Information leakage | Pass. Public read models contain domain facts and opaque identifiers only. |
| Temporal decomposition | Pass. Modules own knowledge, not load/validate/save stages. |
| Pass-through | Pass. Open replaces the old writers rather than forwarding to them. |
| Split ownership | Pass. Core marks, connection facts, window state and pixel offsets each have one owner. |
| Two ways | Pass at cutover. Delete old selection APIs with their final callers. |
| Importable internals | Required resolved-path lint boundary rejects external internal imports; ordinary UI cannot import privileged runtime entries. |
| Hand-synced lists | Pass. One chosen-head rule, run mapping and looking/unread projection. |

## Open questions and risks

- Is moving an already-open chat on explicit split/drop acceptable? This candidate chooses move, not duplicate drafts.
- Should an unfocused on-screen chat suppress its in-app toast? This candidate says no, consistently with the read rule. OS notifications stay out of scope.
- Without host home/machine metadata, should a remote card keep its full path and say "Remote"? This candidate chooses honest fallbacks.

## Next implementation step

Build the all-session chat projection and import boundary, then replace title, run and location reads before navigation.

## Checks

The sketch and caller examples pass strict TypeScript checking against installed SDK/plugin types. Bodies remain unimplemented. App behavior, lint enforcement and store checks were not run. Only `/tmp/arch/sol/` was written; no server was started.
