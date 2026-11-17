---- MODULE DraftRows ----
EXTENDS Naturals
\* One chat id in the sidebar, from the draft's send to the host's own row.
\* HideDrafted: the host's row stays hidden while a draft of the same id exists (the change).
\* KeepDraftWhileStarting: the draft row stays listed while it starts the chat.
CONSTANTS HideDrafted, KeepDraftWhileStarting

VARIABLES draft, created, listed, inflight

vars == <<draft, created, listed, inflight>>

Drafts == {"none", "editing", "waiting", "starting", "failed"}

Init == draft = "editing" /\ created = FALSE /\ listed = FALSE /\ inflight = FALSE

Send == draft \in {"editing", "failed"} /\ ~created /\ draft' = "waiting" /\ UNCHANGED <<created, listed, inflight>>
Cancel == draft = "waiting" /\ draft' = "editing" /\ UNCHANGED <<created, listed, inflight>>
Commit == draft = "waiting" /\ draft' = "starting" /\ inflight' = TRUE /\ UNCHANGED <<created, listed>>
\* sessions.start reaches the host while the draft starts it, or after the user deleted the draft.
HostCreates == inflight /\ ~created /\ created' = TRUE /\ UNCHANGED <<draft, listed, inflight>>
\* The directory's listing arrives on its own schedule, before or after promotion.
Listed == created /\ ~listed /\ listed' = TRUE /\ UNCHANGED <<draft, created, inflight>>
\* openDraftChat removes the draft once the chat exists, whether start resolved or threw after creating it.
Promote == draft = "starting" /\ created /\ draft' = "none" /\ inflight' = FALSE /\ UNCHANGED <<created, listed>>
\* start threw and the host has no such session: the draft comes back with its failure.
Fail == draft = "starting" /\ ~created /\ draft' = "failed" /\ inflight' = FALSE /\ UNCHANGED <<created, listed>>
\* The trash button on the draft row, at any time.
Delete == draft # "none" /\ draft' = "none" /\ UNCHANGED <<created, listed, inflight>>

Next == Send \/ Cancel \/ Commit \/ HostCreates \/ Listed \/ Promote \/ Fail \/ Delete

DraftRowShown == draft # "none" /\ (KeepDraftWhileStarting \/ draft # "starting")
HostRowShown == listed /\ ~(HideDrafted /\ draft # "none")
Rows == (IF DraftRowShown THEN 1 ELSE 0) + (IF HostRowShown THEN 1 ELSE 0)

TypeOK == draft \in Drafts /\ created \in BOOLEAN /\ listed \in BOOLEAN /\ inflight \in BOOLEAN
NoDoubleRow == Rows <= 1
\* A chat the user has sent, or the host lists, always has a row.
NoVanishedChat == (draft # "none" \/ listed) => Rows = 1
====
