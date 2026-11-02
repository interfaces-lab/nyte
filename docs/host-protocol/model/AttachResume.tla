---------------------------- MODULE AttachResume ----------------------------
(* One host, one client, one scope. A row's content is the seq that last  *)
(* changed it; 0 is absent. The host writes and drops rows, logging one    *)
(* event per change. The client subscribes, reads a window, applies        *)
(* events, loses its connection, and resumes with its last seq and the     *)
(* rows it held. docs/host-protocol is the design this checks.             *)

EXTENDS Naturals, FiniteSets

CONSTANTS Rows, MaxSeq, SubscribeBeforeRead, ApplyEarlyEvents, ResumeSendsUnheld

VARIABLES
  hostSeq,      \* the scope's last seq
  hostRow,      \* row -> seq of its last write, 0 when absent
  touched,      \* seq -> the row the event at that seq changed
  value,        \* seq -> the row's content after that event, 0 for a drop
  phase,        \* idle, subscribed, reading, attached, dropped
  resuming,     \* the next read is a resume, not a first snapshot
  connected,    \* events reach the client
  subscribedAt, \* the seq the open connection started delivering above
  delivered,    \* the last seq delivered on the open connection
  clientSeq,    \* the seq the client's rows are current through
  clientRow,    \* row -> what the client holds, 0 when absent
  held,         \* the rows the client's window covers
  readSeq,      \* the seq the pending read was taken at
  readRow,      \* the rows the pending read carries
  readSent,     \* the rows the pending read carries a value for
  readPresent   \* the rows the pending read reports the window has

vars == << hostSeq, hostRow, touched, value, phase, resuming, connected, subscribedAt,
           delivered, clientSeq, clientRow, held, readSeq, readRow, readSent, readPresent >>

HostVars == << hostSeq, hostRow, touched, value >>

ReadVars == << readSeq, readRow, readSent, readPresent >>

ClientVars == << phase, resuming, connected, subscribedAt, delivered, clientSeq, clientRow, held >>

Init ==
  /\ hostSeq = 0
  /\ hostRow = [r \in Rows |-> 0]
  /\ touched = [s \in 1..MaxSeq |-> CHOOSE r \in Rows : TRUE]
  /\ value = [s \in 1..MaxSeq |-> 0]
  /\ phase = "idle"
  /\ resuming = FALSE
  /\ connected = FALSE
  /\ subscribedAt = 0
  /\ delivered = 0
  /\ clientSeq = 0
  /\ clientRow = [r \in Rows |-> 0]
  /\ held = {}
  /\ readSeq = 0
  /\ readRow = [r \in Rows |-> 0]
  /\ readSent = {}
  /\ readPresent = {}

Write(r) ==
  /\ hostSeq < MaxSeq
  /\ hostSeq' = hostSeq + 1
  /\ hostRow' = [hostRow EXCEPT ![r] = hostSeq + 1]
  /\ touched' = [touched EXCEPT ![hostSeq + 1] = r]
  /\ value' = [value EXCEPT ![hostSeq + 1] = hostSeq + 1]
  /\ UNCHANGED << ClientVars, ReadVars >>

Drop(r) ==
  /\ hostSeq < MaxSeq
  /\ hostRow[r] > 0
  /\ hostSeq' = hostSeq + 1
  /\ hostRow' = [hostRow EXCEPT ![r] = 0]
  /\ touched' = [touched EXCEPT ![hostSeq + 1] = r]
  /\ value' = [value EXCEPT ![hostSeq + 1] = 0]
  /\ UNCHANGED << ClientVars, ReadVars >>

(* Subscribing opens the event stream at the host's current seq. *)
Subscribe ==
  /\ phase \in {"idle", "dropped"}
  /\ phase' = "subscribed"
  /\ resuming' = (phase = "dropped")
  /\ connected' = TRUE
  /\ subscribedAt' = hostSeq
  /\ delivered' = hostSeq
  /\ UNCHANGED << HostVars, clientSeq, clientRow, held, ReadVars >>

(* A first read carries every row of the window. A resume carries the rows of the window *)
(* changed since the client's seq and, by design, the rows it did not hold. Either says *)
(* which rows the window has, so the client drops the rest. *)
Carries(r) ==
  \/ ~resuming
  \/ hostRow[r] > clientSeq
  \/ (ResumeSendsUnheld /\ r \notin held)

Read ==
  /\ \/ phase = "subscribed"
     \/ (phase \in {"idle", "dropped"} /\ ~SubscribeBeforeRead)
  /\ \E window \in (SUBSET Rows) \ {{}} :
       /\ readSent' = {r \in window : Carries(r)}
       /\ readPresent' = {r \in window : hostRow[r] > 0}
       /\ readRow' = [r \in Rows |-> IF r \in window /\ Carries(r) THEN hostRow[r] ELSE 0]
       /\ held' = window
  /\ readSeq' = hostSeq
  /\ resuming' = (resuming \/ phase = "dropped")
  /\ phase' = "reading"
  /\ UNCHANGED << HostVars, connected, subscribedAt, delivered, clientSeq, clientRow >>

(* The mutant of the attach order: subscribe only once the read is in hand. *)
SubscribeLate ==
  /\ phase = "reading"
  /\ ~SubscribeBeforeRead
  /\ ~connected
  /\ connected' = TRUE
  /\ subscribedAt' = hostSeq
  /\ delivered' = hostSeq
  /\ UNCHANGED << HostVars, phase, resuming, clientSeq, clientRow, held, ReadVars >>

Max(a, b) == IF a >= b THEN a ELSE b

(* The last event in (from, through] that changed `r`, or 0 when none did. *)
LastChange(r, from, through) ==
  LET changes == {s \in (from + 1)..through : touched[s] = r}
  IN IF changes = {} THEN 0 ELSE CHOOSE s \in changes : \A t \in changes : t <= s

(* The read arrives. Rows it carries replace the client's; rows outside the window and rows *)
(* it reports absent go. Events this connection delivered meanwhile, above the read's seq, *)
(* apply on top, by design. *)
Arrive ==
  /\ phase = "reading"
  /\ connected
  /\ LET from == Max(readSeq, subscribedAt)
         through == IF ApplyEarlyEvents THEN delivered ELSE readSeq
         base == [r \in Rows |->
                    IF r \notin held THEN 0
                    ELSE IF r \in readSent THEN readRow[r]
                    ELSE IF r \notin readPresent THEN 0
                    ELSE clientRow[r]]
     IN /\ clientRow' = [r \in Rows |->
            IF r \in held /\ LastChange(r, from, through) > 0
              THEN value[LastChange(r, from, through)]
              ELSE base[r]]
        /\ clientSeq' = Max(readSeq, through)
  /\ phase' = "attached"
  /\ UNCHANGED << HostVars, resuming, connected, subscribedAt, delivered, held, ReadVars >>

(* An event reaches the client. One at or below its seq is already in its rows; one that *)
(* arrives while a read is pending waits for the read. *)
Deliver ==
  /\ connected
  /\ delivered < hostSeq
  /\ delivered' = delivered + 1
  /\ IF phase = "attached" /\ delivered + 1 > clientSeq
       THEN /\ clientSeq' = delivered + 1
            /\ clientRow' = IF touched[delivered + 1] \in held
                              THEN [clientRow EXCEPT ![touched[delivered + 1]] = value[delivered + 1]]
                              ELSE clientRow
       ELSE UNCHANGED << clientSeq, clientRow >>
  /\ UNCHANGED << HostVars, phase, resuming, connected, subscribedAt, held, ReadVars >>

Disconnect ==
  /\ phase = "attached"
  /\ phase' = "dropped"
  /\ connected' = FALSE
  /\ UNCHANGED << HostVars, resuming, subscribedAt, delivered, clientSeq, clientRow, held, ReadVars >>

Next ==
  \/ \E r \in Rows : Write(r) \/ Drop(r)
  \/ Subscribe \/ Read \/ SubscribeLate \/ Arrive \/ Deliver \/ Disconnect

Spec == Init /\ [][Next]_vars

(* Once every logged event has reached an attached client, its window matches the host. *)
Synced ==
  (phase = "attached" /\ connected /\ delivered = hostSeq) =>
    \A r \in held : clientRow[r] = hostRow[r]
=============================================================================
