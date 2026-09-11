# Cursor archive behavior

Source review of installed Cursor 3.19.16. No Cursor files changed and no archive action was executed in the running application.

## Glass sidebar

The traced single-row path does not retain a dimmed row for five seconds.

```text
Archive click
  → confirm if the agent or its subagents are running
  → if selected, choose the next visible agent, or the previous one as fallback
  → add the ID to hiddenAgentIds when archived agents are not shown
  → call the repository archive operation
  → clear the temporary hidden-ID override after settlement
```

The archived flag then owns ordinary filtering. If the operation fails, temporary hiding is removed and selection restoration is guarded against replacing an unrelated newer selection.

Evidence in [workbench.glass.main.js](/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js):

- Line 20648, `glass-archive-agent-undo-service.js`, `archiveAgentWithUndoToast`, and `beginOptimisticArchiveSelection`.
- Line 22325, `_$C`, returned `handleArchiveAgent`, and `ROv`, which updates the hidden-ID set.
- Line 20648, `optimistic-archive-selection.js`, `MUw`, which returns a guarded selection rollback.

The single-archive method's name says `WithUndoToast`, but this installed implementation returns `"archived"` without constructing a toast. Do not infer behavior from that name.

## Bulk archive and Restore

Bulk archive calls `sOv` to collapse rows before calling the repository operations, when item-move animation is active and archived agents are hidden. Every row starts with animation time zero; this is concurrent, not staggered.

The animation changes height to zero and opacity to zero. It reads `--cursor-duration-slow` and `--cursor-easing-out-strong`. The bundled token defaults are 200ms and `cubic-bezier(0.165, 0.84, 0.44, 1)`. A timeout at duration + 50ms prevents waiting indefinitely for animation completion.

The archive service uses `Promise.allSettled`. Its notification offers Undo or Undo all only for successfully archived non-draft agents. Undo calls `unarchiveAgents`; it is an inverse mutation, not cancellation of a delayed archive write.

Restore in the archive-only view also collapses the departing row, then calls `unarchiveAgent`. It selects a successor only if the restored row remains selected when the operation succeeds.

Evidence: `sOv`, `rOv`, `nOv` at glass bundle line 22322; `archiveAgentsWithUndoToast` at line 20648; `handleArchiveAgents` and `handleUnarchiveAgent` in `_$C` at line 22325.

## Persistence and stale-response protection

Glass local archive changes the header immediately, then awaits `composerHeaders` persistence and storage flush. Cloud archive changes optimistic state/cache immediately, performs local stream/draft cleanup, then sends its archive RPC. Cache updates alone do not establish server durability.

Cloud `_pendingArchiveOverrides` has a 60-second TTL. It preserves the optimistic archive/unarchive flag against stale incoming lists until the server agrees or the override expires. It is not a delayed archive commit or row-removal timer. Operations serialize per agent ID, with generation guards against superseded completions. Different agents have independent queues.

See glass bundle line 22813, local `archiveAgent`; line 7675, `persistComposerArchivedState`; and lines 8940 and 8941, cloud archive operations and pending overrides. The traced RPC retry policy permits three attempts, waiting 500ms then 1,000ms between retries.

## Other delays and semantics

`WorktreeArchiveCleanup` at glass bundle line 21806 delays managed-worktree removal by 30 seconds. Unarchive cancels the scheduled cleanup. Cleanup skips permanent worktrees, open workspace folders, and worktrees still used by another unarchived agent, checking the latter conditions again at expiry. This is resource cleanup, not a sidebar recovery window.

The Glass confirmation copy explicitly says archiving stops the active agent's task while running subagents keep working. Nyte currently treats archive as metadata and does not cancel running sessions. Copying that side effect would be a product change, not UI polish.

## Classic desktop sidebar

At [workbench.desktop.main.js:19633](/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js#L19633), `yEy` handles a local composer row:

- Confirm if running.
- Call `cancelChat`.
- Set `isArchived: true` and update `lastUpdatedAt` immediately.
- Open a valid next item or create a new composer when the selected item was archived.
- Restore sets `isArchived: false` and updates `lastUpdatedAt`.

The classic local handler marks headers dirty but does not save or flush directly. The generic save lifecycle persists them later, including a 60-second idle-save interval, or another operation can save sooner. Immediate UI state must not be described as an immediately durable classic-local write.

The legacy `.agent-tab-name.archived` CSS uses opacity 0.6 and a strikethrough. That is archived-state styling, not evidence of a timed retained row.

## What to adopt

Keep archive state, visible-row animation, selection recovery, Undo and resource cleanup separate. Preserve stable row IDs, guarded rollback and concurrent batch exits.

The requested first-action five-second grace and second-action instant mode remain a proposed Nyte behavior. They were not found in these traced Cursor paths. These conclusions come from source inspection, not a live visual test.
