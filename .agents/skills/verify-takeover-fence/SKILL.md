---
name: verify-takeover-fence
description: "Checks that two hosts never drive one run, by checking the takeover design with TLC and the real SQLite implementation with deterministic behavior tests. Load it when changing presence, execution claims, ref fences, the same-machine dead-process verdict, or SQLite refs.set. Not for checking whether `localMachine` reads a pid, boot or start correctly; its own tests cover that."
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

Once B commits a takeover of A's head lease, A must not publish another ref update. It could overwrite B's session state. A delayed local abort in A is fine. A stale SQL write that succeeds is not.

Run both checks and read their results against the rules below. Cite a rule by its number when you report. Rule numbers are stable ids, so a removed rule leaves a gap.

## Run both checks

1. **Run both checks from the repository root.** Neither replaces the other.

   ```sh
   node .agents/skills/verify-takeover-fence/check.mjs
   pnpm --dir packages/host exec vitest run test/takeover-fence.test.ts
   ```

## Design check

2. **`check.mjs` checks `TakeoverFence.tla`.** In the model, B takes A's lease on the 20 s lapse. C takes it on the same-machine verdict that A's OS process is gone. A may exit at any point.
3. **Each configuration must give its required result.** The runner checks these five:

   | Configuration | Required result |
   | --- | --- |
   | All three parameters true | `NoStalePublication`, `NoLiveExitTakeover` pass |
   | `AppendProcessFence=FALSE` | `NoStalePublication` fails |
   | `DeleteProcessOnClaim=FALSE` | `NoStalePublication` fails |
   | `PidCheckSeesExit=FALSE` | `NoLiveExitTakeover` fails |
   | `PidCheckSeesExit=FALSE`, `NoStalePublication` only | Passes (the fence holds under a wrong dead verdict) |

4. **A required failure is a model self-test.** It is a counterexample from the model, not evidence about TypeScript. The runner never reads product code or derives parameters from it.
5. **Read the exit code.** Exit 0 means all five configurations behaved as required. Exit 1 means a failing baseline or a surviving mutant. Exit 2 means a tool failure or a timeout.
6. **Expect these state counts.** The baseline generates 212 states, 159 of them distinct. The last configuration generates 829 and 464. All five take about 2 s once tla-ts is in the pnpm store.

## Why a wrong same-machine verdict is safe

Rules 7 to 12 are one argument, in order.

7. **A fences its writes** on its process ref.
8. **The claim deletes the fence.** It deletes that ref in the lease transaction, expecting the revision it read.
9. **So the fence does not rest on the verdict.** `NoStalePublication` never depends on it. A wrong verdict revokes A at its next write or beat, which is the last configuration.
10. **The verdict guards in-flight work.** Until A is revoked, the verdict keeps A's in-flight work from running beside B's resumed run (`NoLiveExitTakeover`).
11. **Gone means gone on this boot.** It means this boot and pid namespace, with the pid free or held by a process with another start read the same way. A gone process issues no further transaction.
12. **What the machine cannot tell reads alive.** For such a process, the 20 s lapse applies.

## Implementation check

13. **The test runs two presences in one process,** not concurrent OS processes.
14. **Two hosts share one real SQLite connection.** They are member-enabled hosts (`composeServer`, fake-model fixtures) on one real in-memory connection, with A's initial lease seeded. `host.execution.advance` reaches the real `openPresence`, failure-detection preparation and B's `claimNow`.
15. **The test runs 42 orders.** Each order arranges three things. A's wrapper entry, SQL write and post-await reply. A's real heartbeat callback, SQL write and reply. B's prepared claim transaction. The takeover lands before A's wrapper check, between the check and SQL, or after SQL, with the beat on either side.
16. **Only B's transaction may enter A's synchronous interval.** That is the interval from A's wrapper to its SQL. A's own callbacks may not enter it. Steps skipped after revocation are no-ops.
17. **Each order runs under both verdicts.** Under the lapse verdict, fake time pauses A's heartbeat, and B's presence stays writable and observes A for 20 s. Under the exited verdict, B's machine says at once that A's process is gone, while A still runs and writes.
18. **The machines are fakes.** There is no real pid check and no C.
19. **Four rows keep a silent A alive until the lapse.** A's process runs. B's machine cannot tell. A recorded no process. B has no machine.
20. **Promise gates order the steps without sleeps.** The gates order transaction execution and result delivery. They forward the original updates and return SQLite's actual outcomes. They never fake fences, claims or replies.
21. **The oracle is the stored publication.** It is independent of TLC. It reads the stored publication's literal contents after every step, and the lease at B's transaction boundary. Once B commits, B's publication must stay. If A's fresh beat wins first, B's prepared CAS must lose and A may still publish.
22. **Expect 88 cases.** They take about 2 s with Vitest startup.

## Coverage and sync record

23. **The sync commit is the last confirmed product code.** It is `ec59d402346badac166044a865bf81fff401bab1` on `main`.
24. **This table maps each covered source to the behaviour the checks cover.** It names functions, not lines. Line citations live in `TakeoverFence.tla`.

    | Source | Covered behaviour |
    | --- | --- |
    | `packages/core/src/compose.ts` `composeKernel` | Member-enabled kernels use `presence.store`. Tested |
    | `packages/core/src/engine/presence.ts` `openPresence`, `beat`, `revoke`, `store.refs.set` | Registration (`os` from `Machine.self`), heartbeat CAS, automatic process fences, delayed local revocation |
    | `packages/core/src/engine/presence.ts` `gone`, `holder`; `packages/core/src/contract/presence.ts` `Machine`, `Holder` | Claims take the process revision from `dead`, through the lapse or through `Machine.state` saying gone. Tested both ways. The model's C is the second |
    | `packages/host/src/local/process/machine.ts` `localMachine.state` | Neither check. Pid reuse, boots, pid namespaces and start-time precision have real-process tests in `packages/host/test/local-exec.test.ts` |
    | `packages/core/src/drive/execution.ts` `advance`, `claim`, `claimNow` | The test reaches the real claim. Lease acquisition and dead-process deletion share one update array |
    | `packages/core/src/watch/commit.ts` `commit` | Claim publication uses `kernel.store.refs.set` |
    | `packages/core/src/store/log.ts` `admits`, `fenceNames` | Revision expectations and fence-ref existence decide admission |
    | `packages/core/src/store/refs.ts` `leaseRef`, `processRef` | Distinct keys |
    | `packages/host/src/store/sqlite.ts` `connect.refs.set` | Fence checks, expectations, ref changes and events in one `BEGIN IMMEDIATE` transaction. One synchronous attempt under `writeLock`. A busy `BEGIN` retries off the event loop. Nothing awaits inside the attempt |
    | `packages/host/test/takeover-fence.test.ts` `schedules`, `transactionGate`, parameterized test | The implementation check and its scheduler |

25. **The re-review notice never gates.** `check.mjs` first prints `git log` from the sync commit over the covered files. It never gates, even without history. It cannot show uncommitted changes, so review those separately.

When covered code changed, take rules 26 to 29 in order.

26. **Compare the changed behaviour with the model and the scheduler.** Compare each changed function's behaviour and await boundaries with the model actions that cite it, and with the test scheduler. Check relevant callers and helpers outside the table too.
27. **Update the line citations in `TakeoverFence.tla`.** Every variable and action there cites its source.
28. **Run both checks,** the commands in rule 1.
29. **Move the sync commit** to the commit you confirmed, in `SYNC_COMMIT` in `check.mjs` and in rule 23.
30. **Don't commit** while you run this skill.

## Bounds and assumptions

The model's comments state these beside the variables and actions they limit.

31. **A is the incumbent. B and C are contenders.** The model has one head lease, one publication, one heartbeat, one exit of A's OS process, and one claim per contender.
32. **B starts prepared.** B finished reads, object writes and interruption preparation. It saw lease revision 1 and dead process revision 1.
33. **C prepares its claim at its check.** It expects the process revision it reads at its same-machine check.
34. **`Init` is a verification cut,** not one atomic code step. The machine's answer is a design parameter.
35. **Each transaction action is one SQLite transaction.** Post-await replies are separate actions.
36. **`turn` holds A's callbacks back.** A's callbacks can't interleave before its current synchronous call reaches SQL.
37. **Lease ownership stands for its expected revision.** Only the two claims change it here.
38. **Heartbeat revision 2 is a token.** It is a fresh unequal token, not production revision arithmetic.
39. **Instances and revisions are unique.** Contenders keep their own process refs. No old instance re-registers.
40. **Nothing else rejects the selected publication.** Extra expectations and run fences admit it, so no other rejection hides a missing process fence.
41. **SQLite serializes writer transactions.** A successful `COMMIT` is the publication point.
42. **Neither check covers what lies outside these bounds.** That includes unbounded repeated operations, arbitrary process counts, eventual recovery, absent-holder or expiry-only takeovers, process close, lease renewal or release, durable timers, job reaping, other store backends, power-loss durability, external side effects, failure-detector timing, fairness and end-to-end liveness. Neither checks whether every engine caller avoids raw-store writes. The test covers one controlled timing scenario, not every clock discontinuity.

## Mutation evidence

43. **These temporary product edits made the test fail.**

    | Temporary product edit | Vitest result |
    | --- | --- |
    | Remove `name` from the appended fences in `openPresence` | 20 of 88 fail |
    | Remove the dead-process deletion from the claim array in `claimNow` | 38 of 88 fail |
    | Filter out names beginning `processes/` in `fenceNames` | 20 of 88 fail |
    | `gone` counts "cannot tell" as gone | "cannot tell" row fails |
    | `gone` counts a record without a process as gone | "A recorded no process" row fails |

44. **Each failure stored A's publication over B's.** A passed its wrapper check. B committed the takeover and its publication. A's SQL write then overwrote it.
45. **These are behaviour failures.** The design runner still passes with each defect, so they are not source-drift notices.
46. **Restored code passed.** With each file restored, all 88 passed. Unchanged product code showed no stale publication in these schedules.

## Handle a failure

47. **Translate a baseline TLC failure through the citations.** Follow the trace through the model's source citations. Decide whether it shows an implementation mistake or a modelling mistake.
48. **Report a behaviour-test failure with its schedule.** Report the named schedule and the stored lease and publication. A stale write in unchanged product code is a finding.
49. **A passing model mutant means lost sensitivity.** The design check can no longer see that defect. It does not mean the code is safe.
50. **Keep the oracle and the product code.** Don't weaken the oracle or change product code without permission.
51. **Keep model self-tests separate from real-source mutation.** Edit product code temporarily only when permitted, and only when the file has no pre-existing changes. Reverse only that scratch diff. Confirm the status after each reversal.

## Tool setup

52. **The check needs Node and pnpm, not Java.** `check.mjs` runs `tla-ts`, a TypeScript TLA+ model checker, through `pnpm dlx` at its pinned version.
53. **Only tla-ts has checked this model.** An earlier version, without A's exit and the same-machine verdict, explored the same states under TLC 1.7.4.
54. **Temporary files stay outside the repository.** The runner removes them after each run.
55. **The runner limits each step.** 5 s for the history lookup and 120 s per model run.
