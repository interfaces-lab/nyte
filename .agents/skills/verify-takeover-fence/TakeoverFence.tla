-------------------------- MODULE TakeoverFence --------------------------
EXTENDS Naturals

\* Design parameters, not extracted code semantics. run.py checks the TRUE
\* baseline and each FALSE variant as model-level mutation self-tests.
\* AppendProcessFence: openPresence.store.refs.set,
\* packages/core/src/engine/presence.ts:124-129.
\* DeleteProcessOnClaim: claimNow,
\* packages/core/src/drive/execution.ts:532-547.
CONSTANTS AppendProcessFence, DeleteProcessOnClaim

\* Verification cut, NOT a combined read/put/claim action: B and C have
\* independently finished claimNow's earlier awaits and prepared updates for
\* the same lease revision and dead A process revision, both called 1 here.
\* claimNow, packages/core/src/drive/execution.ts:508-547; holder,
\* packages/core/src/engine/presence.ts:147-162. All B/C presence refs exist.
\* A can be paused between its synchronous wrapper and its SQL transaction.
\* A's own callbacks cannot interleave there, but B/C are other OS processes.
Contenders == {"B", "C"}

VARIABLES
  \* SQLite process ref revision, 0 means absent. connect.refs.set,
  \* packages/host/src/sqlite.ts:405-432; processRef,
  \* packages/core/src/store/refs.ts:96-99.
  processRevision,
  \* Lease target's instance. Only one lease CAS succeeds in this cut, so
  \* owner = A also encodes the expected lease revision 1. claimNow,
  \* packages/core/src/drive/execution.ts:532-545.
  leaseOwner,
  \* Each prepared claim's SQL call position, not its caller's held map.
  \* claimNow, packages/core/src/drive/execution.ts:532-563;
  \* connect.refs.set, packages/host/src/sqlite.ts:392-470.
  claimPC,
  \* A's AbortController.signal.aborted. revoke / store.refs.set / beat,
  \* packages/core/src/engine/presence.ts:73-78,99-108,124-135.
  revoked,
  \* A's current synchronous turn before SQL starts. store.refs.set / beat,
  \* packages/core/src/engine/presence.ts:99-104,124-129;
  \* connect.refs.set, packages/host/src/sqlite.ts:392-396.
  turn,
  \* A's one publication: wrapper, transaction, await continuation. The
  \* publication stands for a head/ref update passed through commit and the
  \* presence wrapper, not an immutable objects.put. commit,
  \* packages/core/src/fold/commit.ts:49-68; openPresence.store.refs.set,
  \* packages/core/src/engine/presence.ts:124-137.
  writePC,
  \* Whether A's pending RefUpdate.fences includes processRef(A).
  \* openPresence.store.refs.set,
  \* packages/core/src/engine/presence.ts:127-129.
  writeFence,
  \* A's pending set outcome, read only after the await. connect.refs.set,
  \* packages/host/src/sqlite.ts:405-410,467-470; store.refs.set,
  \* packages/core/src/engine/presence.ts:127-135.
  writeOutcome,
  \* A's one beat: invocation, SQL, await continuation. beat,
  \* packages/core/src/engine/presence.ts:99-115.
  beatPC,
  \* The heartbeat's pending SQL result. beat,
  \* packages/core/src/engine/presence.ts:104-108;
  \* connect.refs.set, packages/host/src/sqlite.ts:413-432.
  beatOutcome,
  \* History witness, not product state: a successful A publication at
  \* connect.refs.set COMMIT, packages/host/src/sqlite.ts:467-470, whose
  \* lease had already changed via claimNow,
  \* packages/core/src/drive/execution.ts:532-547.
  stalePublication

\* Initial cut described above. A registered at revision 1 via openPresence,
\* packages/core/src/engine/presence.ts:60-69; A owns the existing lease
\* written by claimNow, packages/core/src/drive/execution.ts:532-563.
Init ==
  /\ processRevision = 1
  /\ leaseOwner = "A"
  /\ claimPC = [c \in Contenders |-> "sql"]
  /\ revoked = FALSE
  /\ turn = "free"
  /\ writePC = "ready"
  /\ writeFence = FALSE
  /\ writeOutcome = "none"
  /\ beatPC = "ready"
  /\ beatOutcome = "none"
  /\ stalePublication = FALSE

\* One BEGIN IMMEDIATE..COMMIT/ROLLBACK, including ALL updates, not a
\* read followed by a later delete. claimNow's prepared array,
\* packages/core/src/drive/execution.ts:532-547; admits / fenceNames,
\* packages/core/src/store/log.ts:5-14; connect.refs.set,
\* packages/host/src/sqlite.ts:396-470. B/C's own fences always exist.
ClaimTransaction(c) ==
  /\ claimPC[c] = "sql"
  /\ LET accepted == leaseOwner = "A"
                     /\ (~DeleteProcessOnClaim \/ processRevision = 1)
     IN /\ leaseOwner' = IF accepted THEN c ELSE leaseOwner
        /\ processRevision' = IF accepted /\ DeleteProcessOnClaim
                               THEN 0 ELSE processRevision
  /\ claimPC' = [claimPC EXCEPT ![c] = "done"]
  /\ UNCHANGED <<revoked, turn, writePC, writeFence, writeOutcome,
                 beatPC, beatOutcome, stalePublication>>

\* Synchronous pre-await part of store.refs.set, openPresence,
\* packages/core/src/engine/presence.ts:124-129. A can be OS-paused before
\* entering raw.refs.set's SQL, but cannot run another A callback there.
BeginWrite ==
  /\ writePC = "ready" /\ turn = "free"
  /\ writePC' = IF revoked THEN "done" ELSE "sql"
  /\ writeFence' = AppendProcessFence
  /\ turn' = IF revoked THEN "free" ELSE "write"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, revoked,
                 writeOutcome, beatPC, beatOutcome, stalePublication>>

\* One publication transaction: fence checked and ref/log changes committed
\* together. connect.refs.set, packages/host/src/sqlite.ts:396-470.
\* No other expectations reject this chosen publication. This includes an
\* unconditional RefUpdate, a stronger adversary than a stale target CAS.
WriteTransaction ==
  /\ writePC = "sql" /\ turn = "write"
  /\ LET accepted == ~writeFence \/ processRevision # 0
     IN /\ writeOutcome' = IF accepted THEN "set" ELSE "fenced"
        /\ stalePublication' = (stalePublication
                                 \/ (accepted /\ leaseOwner # "A"))
  /\ writePC' = "reply"
  /\ turn' = "free"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, revoked,
                 writeFence, beatPC, beatOutcome>>

\* Continuation AFTER await raw.refs.set. store.refs.set / revoke,
\* packages/core/src/engine/presence.ts:73-78,127-137.
ReplyWrite ==
  /\ writePC = "reply" /\ turn = "free"
  /\ revoked' = (revoked \/ writeOutcome = "fenced")
  /\ writePC' = "done"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, turn, writeFence,
                 writeOutcome, beatPC, beatOutcome, stalePublication>>

\* One timer invocation's synchronous pre-await part. beat,
\* packages/core/src/engine/presence.ts:99-104. Only one beat is in scope,
\* so its captured local revision is 1 and no second beating call runs.
BeginBeat ==
  /\ beatPC = "ready" /\ turn = "free"
  /\ beatPC' = IF revoked THEN "done" ELSE "sql"
  /\ turn' = IF revoked THEN "free" ELSE "beat"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, revoked,
                 writePC, writeFence, writeOutcome, beatOutcome,
                 stalePublication>>

\* One raw heartbeat SQL transaction. beat,
\* packages/core/src/engine/presence.ts:104; admits,
\* packages/core/src/store/log.ts:5-10; connect.refs.set,
\* packages/host/src/sqlite.ts:413-432. Revision 2 is a fresh unequal token.
BeatTransaction ==
  /\ beatPC = "sql" /\ turn = "beat"
  /\ beatOutcome' = IF processRevision = 1 THEN "set" ELSE "stale"
  /\ processRevision' = IF processRevision = 1 THEN 2 ELSE processRevision
  /\ beatPC' = "reply"
  /\ turn' = "free"
  /\ UNCHANGED <<leaseOwner, claimPC, revoked, writePC, writeFence,
                 writeOutcome, stalePublication>>

\* Continuation AFTER heartbeat await. beat / revoke,
\* packages/core/src/engine/presence.ts:73-78,104-114. Updating revision,
\* wroteAt and seen has no effect on this one-beat cut and is projected out.
ReplyBeat ==
  /\ beatPC = "reply" /\ turn = "free"
  /\ revoked' = (revoked \/ beatOutcome = "stale")
  /\ beatPC' = "done"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, turn, writePC,
                 writeFence, writeOutcome, beatOutcome, stalePublication>>

\* Union of beat / store.refs.set, packages/core/src/engine/presence.ts:99-137,
\* and claimNow, packages/core/src/drive/execution.ts:532-547, through
\* connect.refs.set, packages/host/src/sqlite.ts:392-470. Terminal states and
\* indefinitely paused actors are allowed; no fairness or liveness claim.
Next == (\E c \in Contenders : ClaimTransaction(c))
        \/ BeginWrite \/ WriteTransaction \/ ReplyWrite
        \/ BeginBeat \/ BeatTransaction \/ ReplyBeat

\* A publication that COMMITs after another process's takeover is forbidden.
\* COMMIT: connect.refs.set, packages/host/src/sqlite.ts:467-470;
\* takeover: claimNow, packages/core/src/drive/execution.ts:532-547.
NoStalePublication == ~stalePublication
=============================================================================
