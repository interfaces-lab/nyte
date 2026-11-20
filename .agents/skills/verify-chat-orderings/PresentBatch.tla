---- MODULE PresentBatch ----
EXTENDS Naturals
\* The transcript's coalesced present across one rendering loop.
\* A change (virtualizer onChange) marks the view dirty and queues one present.
\* present clears dirty; it may itself cause one synchronous change (a measured resize).
\* ByMicrotask: the queued present runs at the next microtask checkpoint (the change).
\*   FALSE models deferring it to the next frame's animation-frame callbacks.
\* ClearBeforePresent: the queue flag is cleared before present runs (the change).
CONSTANTS ByMicrotask, ClearBeforePresent, MaxChanges

VARIABLES phase, dirty, queued, microtask, changes, painted

vars == <<phase, dirty, queued, microtask, changes, painted>>

\* phase walks one frame: tasks run, then rAF callbacks, layout, ResizeObserver callbacks, paint.
Phases == {"task", "raf", "layout", "observe", "paint"}

Init == phase = "task" /\ dirty = FALSE /\ queued = FALSE /\ microtask = FALSE /\ changes = 0 /\ painted = FALSE

\* A change can come from a commit (task), a scroll event or rAF work, or a ResizeObserver callback.
CanChange == phase \in {"task", "raf", "observe"} /\ changes < MaxChanges

Change ==
  /\ CanChange
  /\ dirty' = TRUE
  /\ changes' = changes + 1
  /\ IF queued THEN UNCHANGED <<queued, microtask>>
     ELSE /\ queued' = TRUE
          /\ microtask' = ByMicrotask
  /\ UNCHANGED <<phase, painted>>

\* present clears the flag (or not, in the mutant), then may cause one nested change.
Present(nested) ==
  /\ nested => changes < MaxChanges
  /\ changes' = IF nested THEN changes + 1 ELSE changes
  /\ dirty' = nested
  /\ IF nested /\ ClearBeforePresent
       THEN /\ queued' = TRUE /\ microtask' = (ByMicrotask \/ microtask)
       ELSE /\ queued' = FALSE /\ microtask' = FALSE

\* The layout effect's presentNow runs synchronously inside a commit.
PresentNow == phase = "task" /\ \E nested \in BOOLEAN : Present(nested) /\ UNCHANGED <<phase, painted>>

\* The microtask checkpoint after the current task or callback runs the queued present, if any is still queued.
RunMicrotask ==
  /\ microtask
  /\ IF queued
       THEN \E nested \in BOOLEAN : Present(nested)
       ELSE /\ microtask' = FALSE /\ UNCHANGED <<dirty, queued, changes>>
  /\ UNCHANGED <<phase, painted>>

\* Deferred mode: the queued present runs in the next frame's rAF callbacks.
RunInRaf ==
  /\ ~ByMicrotask /\ phase = "raf" /\ queued
  /\ dirty' = FALSE /\ queued' = FALSE
  /\ UNCHANGED <<phase, microtask, changes, painted>>

\* Rendering only moves on once the microtask queue is empty.
Advance ==
  /\ ~microtask
  /\ phase # "paint"
  \* Queued rAF callbacks always run before layout.
  /\ ~(phase = "raf" /\ ~ByMicrotask /\ queued)
  /\ phase' = CASE phase = "task" -> "raf"
                [] phase = "raf" -> "layout"
                [] phase = "layout" -> "observe"
                [] phase = "observe" -> "paint"
  /\ painted' = (phase' = "paint")
  /\ UNCHANGED <<dirty, queued, microtask, changes>>

NextFrame ==
  /\ phase = "paint"
  /\ phase' = "task" /\ painted' = FALSE
  /\ UNCHANGED <<dirty, queued, microtask, changes>>

Next == Change \/ PresentNow \/ RunMicrotask \/ RunInRaf \/ Advance \/ NextFrame

\* No painted frame shows a change the transcript has not presented.
PaintsPresented == painted => ~dirty
====
