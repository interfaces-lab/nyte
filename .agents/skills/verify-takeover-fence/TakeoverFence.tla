-------------------------- MODULE TakeoverFence --------------------------
EXTENDS Naturals

\* Design parameters, not extracted code semantics. check.mjs checks the TRUE
\* baseline and each FALSE variant as model-level mutation self-tests.
\* AppendProcessFence: openPresence.store.refs.set,
\* packages/core/src/engine/presence.ts:114-128.
\* DeleteProcessOnClaim: claimNow,
\* packages/core/src/drive/execution.ts:544-559.
\* PidCheckSeesExit: holder / gone, packages/core/src/engine/presence.ts:72-77,
\* 137-160, through Machine.state, packages/core/src/contract/presence.ts:14-21,
\* and localMachine.state, packages/host/src/local/process/machine.ts. TRUE: the
\* same-machine check says gone only once A's OS process is gone.
CONSTANTS AppendProcessFence, DeleteProcessOnClaim, PidCheckSeesExit

\* Verification cut, NOT a combined read/put/claim action. B has finished
\* claimNow's earlier awaits on the 20 s lapse verdict and prepared its claim for
\* lease revision 1 and dead A process revision 1. C is the same-machine path:
\* it prepares its claim only after its check of A's OS process, expecting the
\* process revision it read then. claimNow,
\* packages/core/src/drive/execution.ts:512-578; holder,
\* packages/core/src/engine/presence.ts:137-160. All B/C presence refs exist.
\* A can be paused between its synchronous wrapper and its SQL transaction.
\* A's own callbacks cannot interleave there, but B/C are other OS processes.
Contenders == {"B", "C"}

VARIABLES
  \* SQLite process ref revision, 0 means absent. connect.refs.set,
  \* packages/host/src/store/sqlite.ts:511-630; processRef,
  \* packages/core/src/store/refs.ts:113-115.
  processRevision,
  \* Lease target's instance. Only one lease CAS succeeds in this cut, so
  \* owner = A also encodes the expected lease revision 1. claimNow,
  \* packages/core/src/drive/execution.ts:544-555.
  leaseOwner,
  \* Each claim's position: "check" before C's same-machine check, "sql" once
  \* prepared, "done" after its transaction. claimNow,
  \* packages/core/src/drive/execution.ts:512-578; connect.refs.set,
  \* packages/host/src/store/sqlite.ts:511-630.
  claimPC,
  \* The process revision each prepared claim expects to delete. holder,
  \* packages/core/src/engine/presence.ts:139,149; claimNow,
  \* packages/core/src/drive/execution.ts:555-557.
  expected,
  \* A's OS process is gone: no further A transaction can start, and one it
  \* died inside never commits. holder / gone,
  \* packages/core/src/engine/presence.ts:72-77,137-160.
  aExited,
  \* A's AbortController.signal.aborted. revoke / store.refs.set / beat,
  \* packages/core/src/engine/presence.ts:56-61,89-106,114-128.
  revoked,
  \* A's current synchronous turn before SQL starts. store.refs.set / beat,
  \* packages/core/src/engine/presence.ts:89-94,114-117;
  \* connect.refs.set, packages/host/src/store/sqlite.ts:511-517.
  turn,
  \* A's one publication: wrapper, transaction, await continuation. The
  \* publication stands for a head/ref update passed through commit and the
  \* presence wrapper, not an immutable objects.put. commit,
  \* packages/core/src/watch/commit.ts:57-77; openPresence.store.refs.set,
  \* packages/core/src/engine/presence.ts:114-128.
  writePC,
  \* Whether A's pending RefUpdate.fences includes processRef(A).
  \* openPresence.store.refs.set,
  \* packages/core/src/engine/presence.ts:117-119.
  writeFence,
  \* A's pending set outcome, read only after the await. connect.refs.set,
  \* packages/host/src/store/sqlite.ts:526-532,614-617; store.refs.set,
  \* packages/core/src/engine/presence.ts:117-126.
  writeOutcome,
  \* A's one beat: invocation, SQL, await continuation. beat,
  \* packages/core/src/engine/presence.ts:89-106.
  beatPC,
  \* The heartbeat's pending SQL result. beat,
  \* packages/core/src/engine/presence.ts:94-98;
  \* connect.refs.set, packages/host/src/store/sqlite.ts:534-558.
  beatOutcome,
  \* History witness, not product state: a successful A publication at
  \* connect.refs.set COMMIT, packages/host/src/store/sqlite.ts:614, whose
  \* lease had already changed via claimNow,
  \* packages/core/src/drive/execution.ts:544-559.
  stalePublication,
  \* History witness: C's claim, prepared on the same-machine verdict,
  \* committed while A's OS process still ran.
  liveExitTakeover

vars == <<processRevision, leaseOwner, claimPC, expected, aExited, revoked,
          turn, writePC, writeFence, writeOutcome, beatPC, beatOutcome,
          stalePublication, liveExitTakeover>>

\* Initial cut described above. A registered at revision 1 via openPresence,
\* packages/core/src/engine/presence.ts:21-53; A owns the existing lease
\* written by claimNow, packages/core/src/drive/execution.ts:512-578.
Init ==
  /\ processRevision = 1
  /\ leaseOwner = "A"
  /\ claimPC = [c \in Contenders |-> IF c = "B" THEN "sql" ELSE "check"]
  /\ expected = [c \in Contenders |-> 1]
  /\ aExited = FALSE
  /\ revoked = FALSE
  /\ turn = "free"
  /\ writePC = "ready"
  /\ writeFence = FALSE
  /\ writeOutcome = "none"
  /\ beatPC = "ready"
  /\ beatOutcome = "none"
  /\ stalePublication = FALSE
  /\ liveExitTakeover = FALSE

\* A's OS process ends at any point: SIGKILL, OOM or a stop grace that ran
\* out. A transaction is atomic, so one in flight either committed in an
\* earlier WriteTransaction/BeatTransaction step or never does.
ExitA ==
  /\ ~aExited
  /\ aExited' = TRUE
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, revoked, turn,
                 writePC, writeFence, writeOutcome, beatPC, beatOutcome,
                 stalePublication, liveExitTakeover>>

\* C's same-machine verdict. holder reads A's process ref, then asks the
\* machine about the OS process its record names, and answers dead with the
\* revision it read, packages/core/src/engine/presence.ts:137-160. With
\* PidCheckSeesExit the machine says gone only once A's process is gone; the
\* FALSE variant stands for a check that says gone for a running process.
PidCheck ==
  /\ claimPC["C"] = "check"
  /\ processRevision # 0
  /\ leaseOwner = "A"
  /\ (aExited \/ ~PidCheckSeesExit)
  /\ claimPC' = [claimPC EXCEPT !["C"] = "sql"]
  /\ expected' = [expected EXCEPT !["C"] = processRevision]
  /\ UNCHANGED <<processRevision, leaseOwner, aExited, revoked, turn, writePC,
                 writeFence, writeOutcome, beatPC, beatOutcome,
                 stalePublication, liveExitTakeover>>

\* One BEGIN IMMEDIATE..COMMIT/ROLLBACK, including ALL updates, not a
\* read followed by a later delete. claimNow's prepared array,
\* packages/core/src/drive/execution.ts:544-559; admits / fenceNames,
\* packages/core/src/store/log.ts:13-23; connect.refs.set,
\* packages/host/src/store/sqlite.ts:511-630. B/C's own fences always exist.
ClaimTransaction(c) ==
  /\ claimPC[c] = "sql"
  /\ LET accepted == leaseOwner = "A"
                     /\ (~DeleteProcessOnClaim \/ processRevision = expected[c])
     IN /\ leaseOwner' = IF accepted THEN c ELSE leaseOwner
        /\ processRevision' = IF accepted /\ DeleteProcessOnClaim
                               THEN 0 ELSE processRevision
        /\ liveExitTakeover' = (liveExitTakeover
                                 \/ (accepted /\ c = "C" /\ ~aExited))
  /\ claimPC' = [claimPC EXCEPT ![c] = "done"]
  /\ UNCHANGED <<expected, aExited, revoked, turn, writePC, writeFence,
                 writeOutcome, beatPC, beatOutcome, stalePublication>>

\* Synchronous pre-await part of store.refs.set, openPresence,
\* packages/core/src/engine/presence.ts:114-119. A can be OS-paused before
\* entering raw.refs.set's SQL, but cannot run another A callback there.
BeginWrite ==
  /\ ~aExited
  /\ writePC = "ready" /\ turn = "free"
  /\ writePC' = IF revoked THEN "done" ELSE "sql"
  /\ writeFence' = AppendProcessFence
  /\ turn' = IF revoked THEN "free" ELSE "write"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, aExited,
                 revoked, writeOutcome, beatPC, beatOutcome, stalePublication,
                 liveExitTakeover>>

\* One publication transaction: fence checked and ref/log changes committed
\* together. connect.refs.set, packages/host/src/store/sqlite.ts:511-630.
\* No other expectations reject this chosen publication. This includes an
\* unconditional RefUpdate, a stronger adversary than a stale target CAS.
WriteTransaction ==
  /\ ~aExited
  /\ writePC = "sql" /\ turn = "write"
  /\ LET accepted == ~writeFence \/ processRevision # 0
     IN /\ writeOutcome' = IF accepted THEN "set" ELSE "fenced"
        /\ stalePublication' = (stalePublication
                                 \/ (accepted /\ leaseOwner # "A"))
  /\ writePC' = "reply"
  /\ turn' = "free"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, aExited,
                 revoked, writeFence, beatPC, beatOutcome, liveExitTakeover>>

\* Continuation AFTER await raw.refs.set. store.refs.set / revoke,
\* packages/core/src/engine/presence.ts:56-61,117-126.
ReplyWrite ==
  /\ ~aExited
  /\ writePC = "reply" /\ turn = "free"
  /\ revoked' = (revoked \/ writeOutcome = "fenced")
  /\ writePC' = "done"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, aExited, turn,
                 writeFence, writeOutcome, beatPC, beatOutcome,
                 stalePublication, liveExitTakeover>>

\* One timer invocation's synchronous pre-await part. beat,
\* packages/core/src/engine/presence.ts:89-94. Only one beat is in scope,
\* so its captured local revision is 1 and no second beating call runs.
BeginBeat ==
  /\ ~aExited
  /\ beatPC = "ready" /\ turn = "free"
  /\ beatPC' = IF revoked THEN "done" ELSE "sql"
  /\ turn' = IF revoked THEN "free" ELSE "beat"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, aExited,
                 revoked, writePC, writeFence, writeOutcome, beatOutcome,
                 stalePublication, liveExitTakeover>>

\* One raw heartbeat SQL transaction. beat,
\* packages/core/src/engine/presence.ts:94; admits,
\* packages/core/src/store/log.ts:13-19; connect.refs.set,
\* packages/host/src/store/sqlite.ts:534-558. Revision 2 is a fresh unequal token.
BeatTransaction ==
  /\ ~aExited
  /\ beatPC = "sql" /\ turn = "beat"
  /\ beatOutcome' = IF processRevision = 1 THEN "set" ELSE "stale"
  /\ processRevision' = IF processRevision = 1 THEN 2 ELSE processRevision
  /\ beatPC' = "reply"
  /\ turn' = "free"
  /\ UNCHANGED <<leaseOwner, claimPC, expected, aExited, revoked, writePC,
                 writeFence, writeOutcome, stalePublication, liveExitTakeover>>

\* Continuation AFTER heartbeat await. beat / revoke,
\* packages/core/src/engine/presence.ts:56-61,94-104. Updating revision,
\* wroteAt and seen has no effect on this one-beat cut and is projected out.
ReplyBeat ==
  /\ ~aExited
  /\ beatPC = "reply" /\ turn = "free"
  /\ revoked' = (revoked \/ beatOutcome = "stale")
  /\ beatPC' = "done"
  /\ UNCHANGED <<processRevision, leaseOwner, claimPC, expected, aExited, turn,
                 writePC, writeFence, writeOutcome, beatOutcome,
                 stalePublication, liveExitTakeover>>

\* Union of beat / store.refs.set, packages/core/src/engine/presence.ts:89-128,
\* the same-machine verdict, presence.ts:72-77,137-160, and claimNow,
\* packages/core/src/drive/execution.ts:544-559, through connect.refs.set,
\* packages/host/src/store/sqlite.ts:511-630. Terminal states and indefinitely
\* paused actors are allowed; no fairness or liveness claim.
Next == (\E c \in Contenders : ClaimTransaction(c))
        \/ PidCheck \/ ExitA
        \/ BeginWrite \/ WriteTransaction \/ ReplyWrite
        \/ BeginBeat \/ BeatTransaction \/ ReplyBeat

\* A publication that COMMITs after another process's takeover is forbidden.
\* COMMIT: connect.refs.set, packages/host/src/store/sqlite.ts:614;
\* takeover: claimNow, packages/core/src/drive/execution.ts:544-559.
NoStalePublication == ~stalePublication

\* A takeover on the same-machine verdict never happens while A's OS process
\* runs. Its violation is not a stale publication, which the fence still
\* refuses, but A's work in flight running beside B's until A is revoked.
NoLiveExitTakeover == ~liveExitTakeover
=============================================================================
