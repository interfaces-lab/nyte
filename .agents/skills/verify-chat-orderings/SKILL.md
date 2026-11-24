---
name: verify-chat-orderings
description: "Checks two chat orderings with TLC: a draft becoming its chat shows exactly one sidebar row, and the transcript never paints a frame it has not presented. Load it when changing how the sidebar lists drafts beside the host's rows, how a draft starts its chat, or how the transcript queues its present. Not for scroll rules themselves; the transcript's movement rules and frame tests own those."
paths:
  - "packages/app/src/sidebar/sidebar-lists.tsx"
  - "packages/app/src/sidebar/sidebar-rows.tsx"
  - "packages/app/src/chat/composer/draft-start.ts"
  - "packages/app/src/chat/transcript/transcript.tsx"
---

# Verify chat orderings

Run the check from the repository root and read its exit code.

```sh
node .agents/skills/verify-chat-orderings/check.mjs
```

- Exit 0: every configuration gave its required result.
- Exit 1: a failing design or a surviving mutant.
- Exit 2: a tool failure.

A required failure is a model self-test. It proves the model can see the defect it guards against.

The models never read TypeScript. A passing check says the design holds, not that the code matches it. When you change the code, compare it against the actions below.

All six configurations finish in a few seconds once tla-ts is in the pnpm store.

## Draft rows (`DraftRows.tla`)

1. **The model follows one chat id,** from a draft's send to the host's own row. The draft is editing, waiting, starting, failed or gone. The host creates the session only for a committed start. The directory lists it on its own schedule, before or after the draft is promoted.
2. **Actions.** Send, cancel and commit. The host creating the session. The directory listing it. Promotion, which is `openDraftChat` removing the draft once the chat exists, whether the start resolved or threw after creating it. Failure without a session. Deleting the draft at any time.
3. **Invariants.** `NoDoubleRow`: at most one row for the id. `NoVanishedChat`: a draft or a listed chat always has its row.
4. **The design.** It hides the host's row while a draft of the same id exists (`HideDrafted`). It keeps the draft row while it starts (`KeepDraftWhileStarting`). The starting row carries the working indicator.

| Configuration | Required result |
| --- | --- |
| The design | Both invariants hold |
| `HideDrafted=FALSE` | `NoDoubleRow` fails: the host lists the chat while its draft still starts |
| `KeepDraftWhileStarting=FALSE` | `NoVanishedChat` fails: the chat has no row until the host lists it |

## Transcript present (`PresentBatch.tla`)

5. **The model follows one rendering loop:** tasks, animation-frame callbacks, layout, ResizeObserver callbacks, paint. A microtask checkpoint runs after each task and callback. Rendering moves on only with the microtask queue empty.
6. **Actions.** A virtualizer change marks the view dirty and queues one present. The layout effect presents at once. A present may cause one nested change.
7. **Invariant.** `PaintsPresented`: no painted frame shows a change the transcript has not presented.
8. **The design.** It runs the queued present at the next microtask checkpoint (`ByMicrotask`). It clears the queue before presenting (`ClearBeforePresent`), so a nested change queues again.

| Configuration | Required result |
| --- | --- |
| The design | `PaintsPresented` holds |
| `ByMicrotask=FALSE` | Fails: a ResizeObserver change after the frame's animation-frame callbacks paints unpresented |
| `ClearBeforePresent=FALSE` | Fails: a change the present causes is dropped |
