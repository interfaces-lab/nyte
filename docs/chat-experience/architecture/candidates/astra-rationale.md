# Astra: one window, one published answer

## Problem

The shell lets each component join host data with its own idea of selection, focus and unread. Replace those joins with one window-owned snapshot. Keep the grounding's hard constraints: one active host workspace, explicit monotone `see`, plugin execution mapping, tabs as navigation authority, debounced existing storage and TanStack Virtual. This is an app architecture, not a new SDK subsystem.

## Usage (caller's view)

Written before the types. Components select domain records; commands complete the interaction without caller-managed activation, preview promotion, read capture or focus ordering.

```ts
import { chatShell, useChatIdentity, useChatShell } from "../shell/chat-shell/index.ts";

// chrome/sidebar.tsx:81–93: no separate activateWorkspace or pane-drop call.
void chatShell.openChat({ chat: sessionId, intent: { kind: "preview" } });
// Modified click uses background; side-open uses split with an addressed target.

// screens/session-conversation.tsx:510–513: keep the parent in its own pane.
void chatShell.openChat({
  chat: childId,
  intent: { kind: "next-to-parent", parent: parentAddress },
});
// parentAddress names tab, pane and parent chat, not whatever is active later.

// tabs/use-window-tabs.tsx:113–186: delete roots-only joins and status mapping.
const tabs = useChatShell((window) => window.tabs);
// components/chat-card.tsx:84–110 on chat-shell: retain metadata, same identity.
const card = useChatIdentity(sessionId);

// conversation/transcript.tsx:755–758: follow and focus, leaving divider intact.
chatShell.interact({ kind: "jump-to-end", transcript: transcriptAddress });
// conversation/composer.tsx: submit wraps the existing send/edit/queue workflow.
void chatShell.submit(editorAddress, "primary");
chatShell.interact({ kind: "picker-closed", editor: editorAddress });
```

## Shape

Replace `WindowTabs` and mutable `PaneController` synchronization with one `ChatShell`. Its private state owns navigation, drafts, visits and focus; its snapshot publishes chats, tabs, transcript attention and sidebar preferences. SDK caches retain message bodies. Appending prose must not rebuild sidebar records.

Private concept files divide knowledge, not writers. Identity joins each chat to its workspace. Status extends plugin `executionMark`; active unpaced view execution wins after its first emission, otherwise list execution wins. Every current-status indicator reads that result. Own-run capabilities stay distinct from the `subagent-still-working` summary.

One resolver produces selection, presentation and looking. Looking requires a ready, uncovered transcript in the active chat tab and a visible, focused document; either split pane and a tray detail can qualify. Capture a visit's old read boundary before emitting `see`. Blur freezes a visit; leaving its slot ends it. Prefetch never reads.

Interface depth comes from completed operations behind selectors and addressed commands. No public reducer dispatch, controller lookup or wire type. Bindings register editor/scroll capabilities, not visibility decisions. Storage/SDK validation stays at boundaries; private business functions are pure. Details, access paths and persistence keys are in `module-map.md`.

## Synthesis decision

Candidate only; the orchestrator has not compared runners. Choose one window snapshot, not separately subscribed concept stores.

## Tradeoffs accepted

- We accept one substantial owner to delete cross-store synchronization.
- We accept status correction at view/list handoff instead of inventing stream ordering. Indicators change together.
- We accept moving an already-open chat on explicit split instead of duplicating editors sharing a draft. Tray details remain independent readers.
- We accept unknown metadata rather than inventing repo/machine facts.
- We accept an app-local notification plugin using existing dispatch/dedupe, instead of expanding plugin APIs. TUI/mobile retain their default plugin.

## Alternatives considered

- Independent concept stores hide individual rules but expose coordination and read-before-write ordering to callers. Rejected for split ownership.
- SDK/plugin ownership hides transport but exports window/pane/visit concepts into clients without them. Keep only shared execution mapping and D1's wire addition there.
- A read-only facade over current controllers leaves placement bypasses and Activity-based seen marking intact. It cannot enforce its own invariants.

## Red-flag screen

Shallow module: pass, each command completes an interaction. Information leakage: pass, no public wire/storage types. Temporal decomposition: pass, files own concepts rather than processing stages. Pass-throughs: pass, opening hides activation, placement and focus. Split ownership and two ways: pass only when the migration deletes old writers in the same cutover. Importable internals: gated on a resolved-path lint boundary shipped with the first consumer; a barrel alone fails. Hand-synced lists: pass, roots/children/tabs derive from one directory and status/intent handling is exhaustive.

## Open questions and risks

- Does D1's `seenThrough` time preserve the required boundary with equal timestamps and unloaded history? Prove its real cases before adding another wire representation.
- Is move-on-split accepted as the deliberate removal of duplicate draft editors?
- Can restored drafts acquire a known workspace target without losing buffers or guessing a folder?
- Will split/focus/Activity journeys survive removal of PaneController? That is the riskiest cutover.

## Next implementation step

After the builders merge, publish all-chat identity/status, move sidebar and tab readers together, and delete their old joins.

## Candidate checks

Strict TypeScript and formatting passed for the sketch; an AST check found 36 stub bodies and no forbidden syntax. No runtime behavior, app tests or store check was verified. All writes stayed under `/tmp/arch/astra/`; no server was started.
