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

Run the check from the repository root and read its exit code: 0 means every configuration gave its required result, 1 a failing design or a surviving mutant, 2 a tool failure.

```sh
node .agents/skills/verify-chat-orderings/check.mjs
```

A required failure is a model self-test: it proves the model can see the defect it guards against. The models never read TypeScript, so a passing check says the design holds, not that the code matches it. Compare the code against the actions below when you change it.

## Draft rows (`DraftRows.tla`)

1. One chat id, from a draft's send to the host's own row. The draft is editing, waiting, starting, failed or gone. The host creates the session only for a committed start, and the directory lists it on its own schedule, before or after the draft is promoted.
2. Actions: send, cancel, commit, the host creating the session, the directory listing it, promotion (`openDraftChat` removing the draft once the chat exists, whether the start resolved or threw after creating it), failure without a session, and deleting the draft at any time.
3. `NoDoubleRow`: at most one row for the id. `NoVanishedChat`: a draft or a listed chat always has its row.
4. The design hides the host's row while a draft of the same id exists (`HideDrafted`) and keeps the draft row while it starts (`KeepDraftWhileStarting`); the starting row carries the working indicator.

| Configuration | Required result |
| --- | --- |
| The design | Both invariants hold |
| `HideDrafted=FALSE` | `NoDoubleRow` fails: the host lists the chat while its draft still starts |
| `KeepDraftWhileStarting=FALSE` | `NoVanishedChat` fails: the chat has no row until the host lists it |

## Transcript present (`PresentBatch.tla`)

5. One rendering loop: tasks, animation-frame callbacks, layout, ResizeObserver callbacks, paint. A microtask checkpoint runs after each task and callback, and rendering moves on only with the microtask queue empty.
6. A virtualizer change marks the view dirty and queues one present. The layout effect presents at once. A present may cause one nested change.
7. `PaintsPresented`: no painted frame shows a change the transcript has not presented.
8. The design runs the queued present at the next microtask checkpoint (`ByMicrotask`) and clears the queue before presenting (`ClearBeforePresent`), so a nested change queues again.

| Configuration | Required result |
| --- | --- |
| The design | `PaintsPresented` holds |
| `ByMicrotask=FALSE` | Fails: a ResizeObserver change after the frame's animation-frame callbacks paints unpresented |
| `ClearBeforePresent=FALSE` | Fails: a change the present causes is dropped |

All six configurations finish in a few seconds once tla-ts is in the pnpm store.
