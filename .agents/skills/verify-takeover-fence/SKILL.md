---
name: verify-takeover-fence
description: "Check the takeover design with TLC and the real SQLite implementation with deterministic behavior tests when changing presence, execution claims, ref fences, or SQLite refs.set."
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

After B commits a takeover of A's head lease, A must not successfully publish another ref update. A stale publication can overwrite session state produced under B. A delayed local abort notification is allowed; a successful stale SQL write is not.

There are two separate checks. Neither replaces the other.

## Run both checks

From the repository root:

```sh
node .agents/skills/verify-takeover-fence/check.mjs
pnpm --dir packages/host exec vitest run test/takeover-fence.test.ts
```

The first command checks the design in `TakeoverFence.tla`. A contender takes over A's lease on one of two verdicts: B on the 20 s lapse, C on the same-machine check that A's OS process is gone. A may exit at any point. Every run checks five configurations:

| Configuration | Required result |
| --- | --- |
| All three design parameters true | `NoStalePublication` and `NoLiveExitTakeover` pass. |
| `AppendProcessFence=FALSE` | `NoStalePublication` fails with a counterexample. |
| `DeleteProcessOnClaim=FALSE` | `NoStalePublication` fails with a counterexample. |
| `PidCheckSeesExit=FALSE` | `NoLiveExitTakeover` fails with a counterexample. |
| `PidCheckSeesExit=FALSE`, `NoStalePublication` only | Passes: the fence holds under a wrong dead verdict. |

The three failures are model self-tests, not evidence about TypeScript. The runner never reads product code or derives model parameters from it. A surviving mutant, a failing baseline, a timeout or a tool error makes the command exit nonzero. The baseline currently explores 212 generated states, 159 distinct; the last configuration 829 and 464. All five checks together take about two seconds once tla-ts is in the pnpm store.

Why the same-machine verdict keeps the property: `NoStalePublication` never rested on the verdict being right. A's writes are fenced on its process ref and the claim deletes that ref in the lease transaction, expecting the revision it read, so a wrong verdict only revokes A at its next write or beat; the last configuration checks this. What the verdict guards is the work A has in flight running beside B's resumed run until then, which `NoLiveExitTakeover` names: the verdict says gone only for a process on this boot (and pid namespace) whose pid is free or held by a process with another start read the same way, and a gone process issues no further transaction. Anything it cannot tell reads alive, and the 20 s lapse applies.

The second command checks the real implementation in `packages/host/test/takeover-fence.test.ts`. It composes two member-enabled hosts using `composeServer` and the existing fake-model fixtures over a real in-memory SQLite store. This reaches `openPresence` and B's `claimNow` through `host.execution.advance`. It seeds A's initial lease, not the takeover result. It runs every order twice: once with B's verdict from the 20 s lapse, once from a machine that says A's process is gone, while A's code still runs and writes, which is the wrong-verdict adversary. A table of four rows (A's process runs, B's machine cannot tell, A recorded no process, B has no machine) checks that a silent A stays alive until the lapse.

The test enumerates 42 orders of A's wrapper entry, SQL write and post-await reply; A's real heartbeat callback, SQL write and reply; and B's prepared claim transaction. It includes takeover before A's wrapper check, between the check and SQL, and after SQL, with the beat on either side. A's callbacks cannot run inside A's synchronous wrapper-to-SQL interval; B's transaction can. Operations skipped after revocation become no-ops in the remaining schedule slots.

In the lapse runs, Vitest fake time pauses A's heartbeat while B keeps its own presence writable and observes A for 20 seconds; in the exited runs, B's verdict comes at once. Promise gates then control transaction execution and result delivery without sleeps. The gates forward the original updates to SQLite and return its actual outcomes. They do not manufacture fences, claims or replies. After every scheduled step, the test reads the stored publication and checks its literal contents. It also reads the lease at B's transaction boundary. Once B commits, B's publication must remain stored. If A's fresh beat wins first, B's prepared CAS must lose and A may still publish. The 88 cases pass in about two seconds including Vitest startup.

## Coverage and sync record

Last confirmed product code at `8340c40561f0b02dca04da49b8fb40e7f93e5693` on `main`. The mapping below was rechecked, and both checks run, against the uncommitted change that adds the same-machine verdict; move `SYNC_COMMIT` to the commit that lands it.

| Source and function | Covered behavior |
| --- | --- |
| `packages/core/src/compose.ts:373-429`, `composeKernel` | Member-enabled kernels use `presence.store`. The test exercises this wiring. |
| `packages/core/src/engine/presence.ts:21-61,89-128`, `openPresence`, `beat`, `revoke`, `store.refs.set` | Registration (with the process's `os` from `Machine.self`), heartbeat CAS, automatic process fences and delayed local revocation. |
| `packages/core/src/engine/presence.ts:72-77,137-160`, `gone`, `holder`; `packages/core/src/contract/presence.ts:14-33`, `Machine`, `Holder` | Prepared claims use the process revision from `dead`, which comes from the lapse or from `Machine.state` saying A's process is gone. The test reaches both with a controlled clock and fake machines; the model's C contender stands for the second. |
| `packages/host/src/local/process/machine.ts`, `localMachine.state` | Not reached by either check: its boot, pid and start tests live in `packages/host/test/local-exec.test.ts`. |
| `packages/core/src/drive/execution.ts:147-197,485-489,512-578`, `advance`, `claim`, `claimNow` | The test's public path reaches the real claim. Lease acquisition and dead-process deletion share one update array. |
| `packages/core/src/watch/commit.ts:57-77`, `commit` | Claim publication uses `kernel.store.refs.set`. |
| `packages/core/src/store/log.ts:13-23`, `admits`, `fenceNames` | Revision expectations and existence of fence refs decide admission. |
| `packages/core/src/store/refs.ts:107-115`, `leaseRef`, `processRef` | Lease and process refs use distinct keys. |
| `packages/host/src/store/sqlite.ts:511-630`, `connect.refs.set` | Fence checks, expectations, ref changes and events share one `BEGIN IMMEDIATE` transaction. The transaction is one synchronous attempt under `writeLock`, which retries a busy `BEGIN` off the event loop and never awaits inside the attempt. |
| `packages/host/test/takeover-fence.test.ts`, `schedules`, `transactionGate`, parameterized behavior test | The implementation check and its controllable scheduler. |

`check.mjs` prints the output of this command as a re-review notice:

```sh
git log --oneline 8340c40561f0b02dca04da49b8fb40e7f93e5693..HEAD -- packages/core/src/compose.ts packages/core/src/contract/presence.ts packages/core/src/engine/presence.ts packages/core/src/drive/execution.ts packages/core/src/watch/commit.ts packages/core/src/store/log.ts packages/core/src/store/refs.ts packages/host/src/store/sqlite.ts packages/host/src/local/process/machine.ts
```

History output is not a gate. Unrelated edits do not prevent TLC from running. An unavailable history range is a notice too. Review uncommitted changes separately; this log cannot show them.

When covered functions change, compare their behavior and await boundaries with the cited model actions and the test scheduler. Every model variable and action has source citations. Update those citations when lines move. Inspect relevant caller or helper changes even if they are outside the coverage list. Move the sync commit forward only after confirming the mapping at that commit and running both checks. Do not commit while running this skill. Use `/maintain-formal-verification-skill` when intervening changes did not recheck the model.

## Bounds and assumptions

The model has incumbent A, contenders B and C, one head lease, one publication, one heartbeat, one exit of A's OS process, and one claim per contender. B has already completed its reads, object writes and interruption preparation and observed lease revision 1 and dead process revision 1. C prepares its claim at its same-machine check, expecting the process revision it reads then. `Init` is this verification cut, not a combined atomic code step. The machine's answer is a design parameter: the model does not check pid reuse, boots or start-time precision.

Each transaction action is one SQLite transaction. Post-await replies are separate actions. `turn` prevents callbacks in A from interleaving before its current synchronous call reaches SQL. Lease ownership also represents its expected revision because only the two claims can change it within this cut. Heartbeat revision 2 is a fresh unequal token, not arithmetic on production revisions.

Contenders retain their own process refs. Instances and revisions are unique; an old instance is never re-registered. Extra expectations and run fences for the selected publication admit it, so another rejection cannot hide a missing process fence. SQLite serializes writer transactions. Successful `COMMIT` is the publication point.

The code test uses two presences on one real SQLite connection with controlled call boundaries, not concurrent OS processes. It exercises the model's A/B scheduling projection under both verdicts and adds real registration and failure detection preparation. Its machines are fakes; it does not exercise a real pid check or the third contender. Its oracle is the actual stored ref, independent of TLC and its mutant configurations.

Neither check covers unbounded repeated operations, arbitrary process counts, eventual recovery, absent-holder or expiry-only takeovers, process close, lease renewal/release, durable timers, job reaping, other store backends, power-loss durability or external side effects. The model does not check failure-detector timing, or whether the machine's answer about a pid is right: pid reuse, boots, pid namespaces and start-time precision are tested against real processes in `local-exec.test.ts`, outside both checks. The test covers one controlled timing scenario, not all clock discontinuities. There is no fairness or end-to-end liveness claim and no proof that all engine callers avoid raw-store writes.

## Mutation evidence

The real-code test was run independently against these temporary product edits:

| Temporary edit | Result |
| --- | --- |
| Remove `name` from the appended fences in `presence.ts:118`. | 20 of 88 cases fail. |
| Remove the dead-process deletion from the claim array in `execution.ts:555-557`. | 38 of 88 cases fail. |
| Filter out names beginning `processes/` downstream in `fenceNames`, `store/log.ts:22`. | 20 of 88 cases fail. |
| Count a machine that cannot tell as gone in `gone`, `presence.ts:76`. | The "cannot tell" row fails. |
| Count a record without a process as gone in `gone`, `presence.ts:76`. | The "A recorded no process" row fails. |

Each failure reads `A publication` where `B publication` must remain stored. One failing order is A passing its wrapper check, B committing takeover and its publication, then A's SQL write overwriting it. These are behavior failures, not source-drift notices. The design runner still succeeds while the downstream source defect is present, as expected for a separate design check.

Each product scratch edit was reversed by restoring the file it changed. All 88 behavior cases passed again. No product edits remain. The earlier missing regression coverage is now guarded by this test; no stale publication was found in unchanged product code within these schedules.

## Handle a failure

For a baseline TLC failure, translate the trace using the source citations. Check whether it describes the implementation or a modeling mistake. For a behavior-test failure, report the named schedule and the stored lease and publication. A stale write in unchanged product code is a finding. Do not weaken the oracle or change product code without permission.

A model mutant that passes means the design check lost sensitivity, not that the code is safe. Keep the model self-tests separate from the real-source mutation exercise. Only make temporary product edits when permitted and when the file has no pre-existing changes. Reverse only that scratch diff and confirm status after each reversal.

## Tool setup

The model command needs Node and pnpm. It runs `tla-ts`, a TLA+ model checker in TypeScript, through `pnpm dlx` at the version pinned in `check.mjs`; no Java. An earlier version of this model, without A's exit and the same-machine verdict, explored the same states under TLC 1.7.4; this one has been checked with tla-ts only. Temporary files stay outside the repository and are removed after each run.

History lookup has a 5-second limit and each model run a 120-second limit. Exit 0 means all three design checks met their expected outcomes, 1 means an unexpected property result, and 2 means a tool failure. None of these exit codes claims to verify the TypeScript implementation. Run Vitest too.
