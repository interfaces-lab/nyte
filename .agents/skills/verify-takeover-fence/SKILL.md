---
name: verify-takeover-fence
description: "Check the takeover design with TLC and the real SQLite implementation with deterministic behavior tests when changing presence, execution claims, ref fences, the same-machine dead-process verdict, or SQLite refs.set. Not for checking whether `localMachine` reads a pid, boot or start correctly; its own tests cover that."
paths:
  - "packages/core/src/compose.ts"
  - "packages/core/src/contract/presence.ts"
  - "packages/core/src/engine/presence.ts"
  - "packages/core/src/drive/execution.ts"
  - "packages/core/src/watch/commit.ts"
  - "packages/core/src/store/log.ts"
  - "packages/core/src/store/refs.ts"
  - "packages/host/src/store/sqlite.ts"
  - "packages/host/src/local/process/machine.ts"
  - "packages/host/test/takeover-fence.test.ts"
---

# Verify the takeover fence

Once B commits a takeover of A's head lease, A must not publish another ref update, or it can overwrite session state B produced. A delayed local abort in A is allowed; a stale SQL write that succeeds is not. There are two checks, and neither replaces the other.

## Run both checks

From the repository root:

```sh
node .agents/skills/verify-takeover-fence/check.mjs
pnpm --dir packages/host exec vitest run test/takeover-fence.test.ts
```

### The design check

`check.mjs` checks `TakeoverFence.tla`. A contender takes over A's lease on one of two verdicts: B on the 20 s lapse, C on the same-machine check that A's OS process is gone. A may exit at any point. Every run checks five configurations:

| Configuration | Required result |
| --- | --- |
| All three design parameters true | `NoStalePublication` and `NoLiveExitTakeover` pass. |
| `AppendProcessFence=FALSE` | `NoStalePublication` fails with a counterexample. |
| `DeleteProcessOnClaim=FALSE` | `NoStalePublication` fails with a counterexample. |
| `PidCheckSeesExit=FALSE` | `NoLiveExitTakeover` fails with a counterexample. |
| `PidCheckSeesExit=FALSE`, `NoStalePublication` only | Passes. The fence holds under a wrong dead verdict. |

The three failures are model self-tests, not evidence about TypeScript; the runner never reads product code or derives parameters from it. A surviving mutant, a failing baseline, a timeout or a tool error exits nonzero. The baseline explores 212 generated states, 159 distinct; the last configuration 829 and 464. All five take about 2 s once tla-ts is in the pnpm store.

**Why a same-machine verdict is safe.** `NoStalePublication` never rested on the verdict being right. A's writes are fenced on its process ref, and the claim deletes that ref in the lease transaction, expecting the revision it read. A wrong verdict only revokes A at its next write or beat, which the last configuration checks. The verdict guards A's in-flight work running beside B's resumed run until then, which `NoLiveExitTakeover` names. It says gone only for a process on this boot and pid namespace whose pid is free or held by a process with another start read the same way, and a gone process issues no further transaction. Anything the machine cannot tell reads alive, and the 20 s lapse applies.

### The implementation check

`takeover-fence.test.ts` composes two member-enabled hosts with `composeServer` and the fake-model fixtures over a real in-memory SQLite store, reaching `openPresence` and B's `claimNow` through `host.execution.advance`. It seeds A's initial lease, not the takeover result.

- It enumerates 42 orders of A's wrapper entry, SQL write and post-await reply; A's real heartbeat callback, SQL write and reply; and B's prepared claim transaction. They include takeover before A's wrapper check, between the check and SQL, and after SQL, with the beat on either side. A's callbacks cannot run inside A's synchronous wrapper-to-SQL interval; B's transaction can. Operations skipped after revocation become no-ops in the remaining slots.
- Every order runs twice. In the lapse run, Vitest fake time pauses A's heartbeat while B keeps its own presence writable and observes A for 20 s. In the exited run, B's machine says at once that A's process is gone while A still runs and writes, the wrong-verdict adversary.
- Four rows (A's process runs, B's machine cannot tell, A recorded no process, B has no machine) check that a silent A stays alive until the lapse.
- Promise gates control transaction execution and result delivery without sleeps. They forward the original updates to SQLite and return its actual outcomes, never manufacturing fences, claims or replies.
- After every step the test checks the stored publication's literal contents, and it reads the lease at B's transaction boundary. Once B commits, B's publication must stay stored. If A's fresh beat wins first, B's prepared CAS must lose and A may still publish.

The 88 cases pass in about 2 s including Vitest startup.

## Coverage and sync record

Last confirmed product code at `ec59d402346badac166044a865bf81fff401bab1` on `main`.

| Source and function | Covered behavior |
| --- | --- |
| `packages/core/src/compose.ts:373-429`, `composeKernel` | Member-enabled kernels use `presence.store`; the test exercises this wiring. |
| `packages/core/src/engine/presence.ts:21-61,89-128`, `openPresence`, `beat`, `revoke`, `store.refs.set` | Registration (with the process's `os` from `Machine.self`), heartbeat CAS, automatic process fences, delayed local revocation. |
| `packages/core/src/engine/presence.ts:72-77,137-160`, `gone`, `holder`; `packages/core/src/contract/presence.ts:14-33`, `Machine`, `Holder` | Prepared claims use the process revision from `dead`, from the lapse or from `Machine.state` saying A's process is gone. The test reaches both with a controlled clock and fake machines; the model's C stands for the second. |
| `packages/host/src/local/process/machine.ts`, `localMachine.state` | Reached by neither check. Its boot, pid and start tests are in `packages/host/test/local-exec.test.ts`. |
| `packages/core/src/drive/execution.ts:147-197,485-489,512-578`, `advance`, `claim`, `claimNow` | The test's public path reaches the real claim. Lease acquisition and dead-process deletion share one update array. |
| `packages/core/src/watch/commit.ts:57-77`, `commit` | Claim publication uses `kernel.store.refs.set`. |
| `packages/core/src/store/log.ts:13-23`, `admits`, `fenceNames` | Revision expectations and fence-ref existence decide admission. |
| `packages/core/src/store/refs.ts:107-115`, `leaseRef`, `processRef` | Lease and process refs use distinct keys. |
| `packages/host/src/store/sqlite.ts:511-630`, `connect.refs.set` | Fence checks, expectations, ref changes and events share one `BEGIN IMMEDIATE` transaction: one synchronous attempt under `writeLock`, which retries a busy `BEGIN` off the event loop and never awaits inside the attempt. |
| `packages/host/test/takeover-fence.test.ts`, `schedules`, `transactionGate`, parameterized behavior test | The implementation check and its controllable scheduler. |

`check.mjs` first prints `git log` from the sync commit over the covered source files as a re-review notice. It is not a gate: unrelated edits do not stop TLC, and an unavailable history range is only a notice. It cannot show uncommitted changes, so review those separately.

When covered code changed:

1. Compare each changed function's behavior and await boundaries with the model actions that cite it and with the test scheduler. Inspect relevant callers and helpers outside the coverage list too.
2. Update the line citations in `TakeoverFence.tla`, where every variable and action cites its source, and in this file.
3. Run both checks.
4. Then move the sync commit to the commit you confirmed: `SYNC_COMMIT` in `check.mjs` and the hash above.

Do not commit while running this skill.

## Bounds and assumptions

The model has incumbent A, contenders B and C, one head lease, one publication, one heartbeat, one exit of A's OS process and one claim per contender. B has finished its reads, object writes and interruption preparation, and observed lease revision 1 and dead process revision 1. C prepares its claim at its same-machine check, expecting the process revision it reads then. `Init` is this verification cut, not one atomic code step. The machine's answer is a design parameter; the model does not check pid reuse, boots or start-time precision.

Each transaction action is one SQLite transaction; post-await replies are separate actions. `turn` stops A's callbacks from interleaving before its current synchronous call reaches SQL. Lease ownership also stands for its expected revision, because only the two claims change it within this cut. Heartbeat revision 2 is a fresh unequal token, not arithmetic on production revisions.

Contenders keep their own process refs. Instances and revisions are unique, and an old instance is never re-registered. Extra expectations and run fences for the selected publication admit it, so another rejection cannot hide a missing process fence. SQLite serializes writer transactions. A successful `COMMIT` is the publication point.

The code test runs two presences on one real SQLite connection with controlled call boundaries, not concurrent OS processes. It exercises the model's A/B scheduling under both verdicts, plus real registration and failure-detection preparation. Its machines are fakes, so it exercises neither a real pid check nor the third contender. Its oracle is the actual stored ref, independent of TLC and its mutants.

Neither check covers unbounded repeated operations, arbitrary process counts, eventual recovery, absent-holder or expiry-only takeovers, process close, lease renewal or release, durable timers, job reaping, other store backends, power-loss durability or external side effects. The model does not check failure-detector timing or whether the machine's pid answer is right; pid reuse, boots, pid namespaces and start-time precision are tested against real processes in `local-exec.test.ts`, outside both checks. The test covers one controlled timing scenario, not every clock discontinuity. There is no fairness or end-to-end liveness claim, and no proof that every engine caller avoids raw-store writes.

## Mutation evidence

The real-code test against each temporary product edit:

| Temporary edit | Result |
| --- | --- |
| Remove `name` from the appended fences in `presence.ts:118`. | 20 of 88 cases fail. |
| Remove the dead-process deletion from the claim array in `execution.ts:555-557`. | 38 of 88 cases fail. |
| Filter out names beginning `processes/` downstream in `fenceNames`, `store/log.ts:22`. | 20 of 88 cases fail. |
| Count a machine that cannot tell as gone in `gone`, `presence.ts:76`. | The "cannot tell" row fails. |
| Count a record without a process as gone in `gone`, `presence.ts:76`. | The "A recorded no process" row fails. |

Each failure reads `A publication` where `B publication` must stay stored. One failing order: A passes its wrapper check, B commits the takeover and its publication, then A's SQL write overwrites it. These are behavior failures, not source-drift notices; the design runner still passes with the source defect present, as a separate design check should. Each edit was reverted by restoring its file, and all 88 cases passed again. No stale publication was found in unchanged product code within these schedules.

## Handle a failure

For a baseline TLC failure, translate the trace through the source citations and decide whether it describes the implementation or a modeling mistake. For a behavior-test failure, report the named schedule and the stored lease and publication. A stale write in unchanged product code is a finding. Do not weaken the oracle or change product code without permission.

A model mutant that passes means the design check lost sensitivity, not that the code is safe. Keep the model self-tests separate from the real-source mutation exercise. Make temporary product edits only when permitted and when the file has no pre-existing changes. Reverse only that scratch diff and confirm status after each reversal.

## Tool setup

The model command needs Node and pnpm, no Java. It runs `tla-ts`, a TLA+ model checker in TypeScript, through `pnpm dlx` at the version pinned in `check.mjs`. Only tla-ts has checked this model; an earlier version without A's exit and the same-machine verdict explored the same states under TLC 1.7.4. Temporary files stay outside the repository and are removed after each run.

History lookup has a 5 s limit and each model run 120 s. Exit 0 means all five configurations met their expected outcomes, 1 an unexpected property result, 2 a tool failure. No exit code verifies the TypeScript implementation, so run Vitest too.

## Not covered

- Changing the model's actions, parameters or invariants when covered code changes behavior the model encodes, beyond moving citations.
