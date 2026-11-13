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

Once B commits a takeover of A's head lease, A must not publish another ref update, which could overwrite B's session state. A delayed local abort in A is fine; a stale SQL write that succeeds is not. Run both checks from the repository root. Neither replaces the other.

```sh
node .agents/skills/verify-takeover-fence/check.mjs
pnpm --dir packages/host exec vitest run test/takeover-fence.test.ts
```

## Design check

`check.mjs` checks `TakeoverFence.tla`. B takes A's lease on the 20 s lapse, C on the same-machine verdict that A's OS process is gone. A may exit at any point.

| Configuration | Required result |
| --- | --- |
| All three parameters true | `NoStalePublication`, `NoLiveExitTakeover` pass |
| `AppendProcessFence=FALSE` | `NoStalePublication` fails |
| `DeleteProcessOnClaim=FALSE` | `NoStalePublication` fails |
| `PidCheckSeesExit=FALSE` | `NoLiveExitTakeover` fails |
| `PidCheckSeesExit=FALSE`, `NoStalePublication` only | Passes (the fence holds under a wrong dead verdict) |

- Required failures are counterexamples from model self-tests, not evidence about TypeScript. The runner never reads product code or derives parameters from it.
- Exit 0: all five as required. 1: failing baseline or surviving mutant. 2: tool failure or timeout.
- States: baseline 212 generated, 159 distinct; last configuration 829 and 464. All five take about 2 s once tla-ts is in the pnpm store.

**Why a wrong same-machine verdict is safe.**

1. A's writes are fenced on its process ref.
2. The claim deletes that ref in the lease transaction, expecting the revision it read.
3. So `NoStalePublication` never rests on the verdict. A wrong one revokes A at its next write or beat (the last configuration).
4. Until then the verdict guards against A's in-flight work running beside B's resumed run (`NoLiveExitTakeover`).
5. Gone means this boot and pid namespace, with the pid free or held by a process with another start read the same way. A gone process issues no further transaction.
6. What the machine cannot tell reads alive; the 20 s lapse applies.

## Implementation check

`takeover-fence.test.ts` runs two presences in one process, not concurrent OS processes.

- Two member-enabled hosts (`composeServer`, fake-model fixtures) share one real in-memory SQLite connection; A's initial lease is seeded. `host.execution.advance` reaches real `openPresence`, failure-detection preparation and B's `claimNow`.
- 42 orders of A's wrapper entry, SQL write and post-await reply; A's real heartbeat callback, SQL write and reply; B's prepared claim transaction. The takeover lands before A's wrapper check, between check and SQL, or after SQL, with the beat on either side. B's transaction may enter A's synchronous wrapper-to-SQL interval; A's callbacks may not. Steps skipped after revocation are no-ops.
- Each order runs under both verdicts. Lapse: fake time pauses A's heartbeat; B's presence stays writable and observes A for 20 s. Exited: B's machine says at once that A's process is gone while A still runs and writes. Machines are fakes, so no real pid check and no C.
- Four rows keep a silent A alive until the lapse: A's process runs, B's machine cannot tell, A recorded no process, B has no machine.
- Promise gates order transaction execution and result delivery without sleeps. They forward the original updates and return SQLite's actual outcomes, never faking fences, claims or replies.
- The oracle, independent of TLC, is the stored publication's literal contents after every step and the lease at B's transaction boundary. Once B commits, B's publication must stay. If A's fresh beat wins first, B's prepared CAS must lose and A may still publish.
- 88 cases, about 2 s with Vitest startup.

## Coverage and sync record

Last confirmed product code: `ec59d402346badac166044a865bf81fff401bab1` on `main`.

| Source | Covered behavior |
| --- | --- |
| `packages/core/src/compose.ts:373-429` `composeKernel` | Member-enabled kernels use `presence.store`; tested |
| `packages/core/src/engine/presence.ts:21-61,89-128` `openPresence`, `beat`, `revoke`, `store.refs.set` | Registration (`os` from `Machine.self`), heartbeat CAS, automatic process fences, delayed local revocation |
| `packages/core/src/engine/presence.ts:72-77,137-160` `gone`, `holder`; `packages/core/src/contract/presence.ts:14-33` `Machine`, `Holder` | Claims take the process revision from `dead`, via the lapse or `Machine.state` saying gone. Tested both ways; the model's C is the second |
| `packages/host/src/local/process/machine.ts` `localMachine.state` | Neither check. Pid reuse, boots, pid namespaces and start-time precision have real-process tests in `packages/host/test/local-exec.test.ts` |
| `packages/core/src/drive/execution.ts:147-197,485-489,512-578` `advance`, `claim`, `claimNow` | Test reaches the real claim. Lease acquisition and dead-process deletion share one update array |
| `packages/core/src/watch/commit.ts:57-77` `commit` | Claim publication uses `kernel.store.refs.set` |
| `packages/core/src/store/log.ts:13-23` `admits`, `fenceNames` | Revision expectations and fence-ref existence decide admission |
| `packages/core/src/store/refs.ts:107-115` `leaseRef`, `processRef` | Distinct keys |
| `packages/host/src/store/sqlite.ts:511-630` `connect.refs.set` | Fence checks, expectations, ref changes and events in one `BEGIN IMMEDIATE` transaction, one synchronous attempt under `writeLock`. A busy `BEGIN` retries off the event loop; nothing awaits inside the attempt |
| `packages/host/test/takeover-fence.test.ts` `schedules`, `transactionGate`, parameterized test | The implementation check and its scheduler |

`check.mjs` first prints `git log` from the sync commit over the covered files. This re-review notice never gates, even without history, and cannot show uncommitted changes; review those separately.

When covered code changed:

1. Compare each changed function's behavior and await boundaries with the model actions citing it and the test scheduler. Check relevant callers and helpers outside the table too.
2. Update the line citations in `TakeoverFence.tla` (every variable and action cites its source) and here.
3. Run both checks.
4. Move the sync commit to the one you confirmed: `SYNC_COMMIT` in `check.mjs` and the hash above.

Do not commit while running this skill.

## Bounds and assumptions

- A is the incumbent, B and C contenders. One head lease, publication, heartbeat and exit of A's OS process; one claim per contender.
- B finished reads, object writes and interruption preparation, and saw lease revision 1 and dead process revision 1.
- C prepares its claim at its same-machine check, expecting the process revision it reads then.
- `Init` is this verification cut, not one atomic code step. The machine's answer is a design parameter.
- Each transaction action is one SQLite transaction; post-await replies are separate actions.
- `turn` keeps A's callbacks from interleaving before its current synchronous call reaches SQL.
- Lease ownership stands for its expected revision; only the two claims change it here.
- Heartbeat revision 2 is a fresh unequal token, not production revision arithmetic.
- Contenders keep their own process refs. Instances and revisions are unique; no old instance re-registers.
- Extra expectations and run fences for the selected publication admit it, so no other rejection hides a missing process fence.
- SQLite serializes writer transactions. A successful `COMMIT` is the publication point.

Neither check covers unbounded repeated operations, arbitrary process counts, eventual recovery, absent-holder or expiry-only takeovers, process close, lease renewal or release, durable timers, job reaping, other store backends, power-loss durability, external side effects, failure-detector timing, fairness, end-to-end liveness, or whether every engine caller avoids raw-store writes. The test covers one controlled timing scenario, not every clock discontinuity.

## Mutation evidence

| Temporary product edit | Vitest result |
| --- | --- |
| Remove `name` from the appended fences, `presence.ts:118` | 20 of 88 fail |
| Remove the dead-process deletion from the claim array, `execution.ts:555-557` | 38 of 88 fail |
| Filter out names beginning `processes/` downstream in `fenceNames`, `store/log.ts:22` | 20 of 88 fail |
| `gone` counts "cannot tell" as gone, `presence.ts:76` | "cannot tell" row fails |
| `gone` counts a record without a process as gone, `presence.ts:76` | "A recorded no process" row fails |

Each failure stored `A publication` where `B publication` must stay (A passes its wrapper check, B commits the takeover and its publication, A's SQL write overwrites it). The design runner still passes with each defect, so these are behavior failures, not source-drift notices. With each file restored, all 88 passed. Unchanged product code showed no stale publication in these schedules.

## Handle a failure

- Baseline TLC failure: translate the trace through the source citations; decide whether it is the implementation or a modeling mistake.
- Behavior-test failure: report the named schedule and the stored lease and publication. A stale write in unchanged product code is a finding.
- A passing model mutant means the design check lost sensitivity, not that the code is safe.
- Do not weaken the oracle or change product code without permission.
- Keep model self-tests separate from real-source mutation. Edit product code temporarily only when permitted and the file has no pre-existing changes. Reverse only that scratch diff and confirm status after each reversal.

## Tool setup

Needs Node and pnpm, no Java. `check.mjs` runs `tla-ts`, a TypeScript TLA+ model checker, through `pnpm dlx` at its pinned version. Only tla-ts has checked this model; an earlier version without A's exit and the same-machine verdict explored the same states under TLC 1.7.4. Temporary files stay outside the repository and are removed after each run. Limits are 5 s for history lookup and 120 s per model run.

## Not covered

- Changing the model's actions, parameters or invariants when covered code changes behavior the model encodes, beyond moving citations.
