---
name: verify-takeover-fence
description: "Check the takeover design with TLC and the real SQLite implementation with deterministic behavior tests when changing presence, execution claims, ref fences, or SQLite refs.set."
---

# Verify the takeover fence

After B commits a takeover of A's head lease, A must not successfully publish another ref update. A stale publication can overwrite session state produced under B. A delayed local abort notification is allowed; a successful stale SQL write is not.

There are two separate checks. Neither replaces the other.

## Run both checks

From the repository root:

```sh
python3 .agents/skills/verify-takeover-fence/run.py
pnpm --dir packages/host exec vitest run test/takeover-fence.test.ts
```

The first command checks the design in `TakeoverFence.tla`. Every run checks three configurations:

| Configuration | Required result |
| --- | --- |
| Both design parameters true | `NoStalePublication` passes. |
| `AppendProcessFence=FALSE` | `NoStalePublication` fails with a counterexample. |
| `DeleteProcessOnClaim=FALSE` | `NoStalePublication` fails with a counterexample. |

The two failures are model self-tests, not evidence about TypeScript. The runner never reads product code or derives model parameters from it. A surviving mutant, a failing baseline, a timeout or a tool error makes the command exit nonzero. The baseline currently explores 238 generated states, 131 distinct states, to depth 9. Each mutant produces a four-state counterexample. All three checks together took about 5.4 seconds with the jar cached.

The second command checks the real implementation in `packages/host/test/takeover-fence.test.ts`. It composes two member-enabled hosts using `composeServer` and the existing fake-model fixtures over a real in-memory SQLite store. This reaches `openPresence` and B's `claimNow` through `host.execution.advance`. It seeds A's initial lease, not the takeover result.

The test enumerates 42 orders of A's wrapper entry, SQL write and post-await reply; A's real heartbeat callback, SQL write and reply; and B's prepared claim transaction. It includes takeover before A's wrapper check, between the check and SQL, and after SQL, with the beat on either side. A's callbacks cannot run inside A's synchronous wrapper-to-SQL interval; B's transaction can. Operations skipped after revocation become no-ops in the remaining schedule slots.

Vitest fake time pauses A's heartbeat while B keeps its own presence writable and observes A for 20 seconds. Promise gates then control transaction execution and result delivery without sleeps. The gates forward the original updates to SQLite and return its actual outcomes. They do not manufacture fences, claims or replies. After every scheduled step, the test reads the stored publication and checks its literal contents. It also reads the lease at B's transaction boundary. Once B commits, B's publication must remain stored. If A's fresh beat wins first, B's prepared CAS must lose and A may still publish. The 42 cases pass in about 0.8 seconds including Vitest startup.

## Coverage and sync record

Last confirmed product code at `d142cf6dd8cbddcda21866cd2a795dd33abdb475` on `main`.

| Source and function | Covered behavior |
| --- | --- |
| `packages/core/src/compose.ts:301-314`, `composeKernel` | Member-enabled kernels use `presence.store`. The test exercises this wiring. |
| `packages/core/src/engine/presence.ts:60-78,99-137`, `openPresence`, `beat`, `revoke`, `store.refs.set` | Registration, heartbeat CAS, automatic process fences and delayed local revocation. |
| `packages/core/src/engine/presence.ts:147-162`, `holder` | Prepared claims use the process revision from `dead`. The test reaches that result with a controlled clock; the model starts after it. |
| `packages/core/src/drive/execution.ts:145-193,473-475,500-563`, `advance`, `claim`, `claimNow` | The test's public path reaches the real claim. Lease acquisition and dead-process deletion share one update array. |
| `packages/core/src/fold/commit.ts:49-68`, `commit` | Claim publication uses `kernel.store.refs.set`. |
| `packages/core/src/store/log.ts:5-14`, `admits`, `fenceNames` | Revision expectations and existence of fence refs decide admission. |
| `packages/core/src/store/refs.ts:92-99`, `leaseRef`, `processRef` | Lease and process refs use distinct keys. |
| `packages/host/src/sqlite.ts:392-470`, `connect.refs.set` | Fence checks, expectations, ref changes and events share one `BEGIN IMMEDIATE` transaction. |
| `packages/host/test/takeover-fence.test.ts`, `schedules`, `transactionGate`, parameterized behavior test | The implementation check and its controllable scheduler. |

`run.py` prints the output of this command as a re-review notice:

```sh
git log --oneline d142cf6dd8cbddcda21866cd2a795dd33abdb475..HEAD -- packages/core/src/compose.ts packages/core/src/engine/presence.ts packages/core/src/drive/execution.ts packages/core/src/fold/commit.ts packages/core/src/store/log.ts packages/core/src/store/refs.ts packages/host/src/sqlite.ts
```

History output is not a gate. Unrelated edits do not prevent TLC from running. An unavailable history range is a notice too. Review uncommitted changes separately; this log cannot show them.

When covered functions change, compare their behavior and await boundaries with the cited model actions and the test scheduler. Every model variable and action has source citations. Update those citations when lines move. Inspect relevant caller or helper changes even if they are outside the coverage list. Move the sync commit forward only after confirming the mapping at that commit and running both checks. Do not commit while running this skill. Use `/maintain-formal-verification-skill` when intervening changes did not recheck the model.

## Bounds and assumptions

The model has incumbent A, contenders B and C, one head lease, one publication, one heartbeat, and one prepared claim per contender. Both contenders have already completed their separate reads, object writes and interruption preparation and observed lease revision 1 and dead process revision 1. `Init` is this verification cut, not a combined atomic code step.

Each transaction action is one SQLite transaction. Post-await replies are separate actions. `turn` prevents callbacks in A from interleaving before its current synchronous call reaches SQL. Lease ownership also represents its expected revision because only the two claims can change it within this cut. Heartbeat revision 2 is a fresh unequal token, not arithmetic on production revisions.

Contenders retain their own process refs. Instances and revisions are unique; an old instance is never re-registered. Extra expectations and run fences for the selected publication admit it, so another rejection cannot hide a missing process fence. SQLite serializes writer transactions. Successful `COMMIT` is the publication point.

The code test uses two presences on one real SQLite connection with controlled call boundaries, not concurrent OS processes. It exercises the model's A/B scheduling projection and adds real registration and failure detection preparation. It does not exercise the third contender. Its oracle is the actual stored ref, independent of TLC and its mutant configurations.

Neither check covers unbounded repeated operations, arbitrary process counts, eventual recovery, absent-holder or expiry-only takeovers, process close, lease renewal/release, durable timers, job reaping, other store backends, power-loss durability or external side effects. The model does not check failure-detector timing. The test covers one controlled timing scenario, not all clock discontinuities. There is no fairness or end-to-end liveness claim and no proof that all engine callers avoid raw-store writes.

## Mutation evidence

The real-code test was run independently against these temporary product edits:

| Temporary edit | Result |
| --- | --- |
| Remove `name` from the appended fences in `presence.ts:128`. | 10 of 42 schedules fail. |
| Remove the dead-process deletion from the claim array in `execution.ts:543-545`. | 19 of 42 schedules fail. |
| Filter out names beginning `processes/` downstream in `fenceNames`, `store/log.ts:14`. | 10 of 42 schedules fail. |

Each failure reads `A publication` where `B publication` must remain stored. One failing order is A passing its wrapper check, B committing takeover and its publication, then A's SQL write overwriting it. These are behavior failures, not source-drift notices. The design runner still succeeds while the downstream source defect is present, as expected for a separate design check.

Each product scratch edit was reversed with `git diff -- <file> | git apply -R`. Repository status returned to the same four untracked additions each time, and all 42 behavior cases passed again. No product edits remain. The earlier missing regression coverage is now guarded by this test; no stale publication was found in unchanged product code within these schedules.

## Handle a failure

For a baseline TLC failure, translate the trace using the source citations. Check whether it describes the implementation or a modeling mistake. For a behavior-test failure, report the named schedule and the stored lease and publication. A stale write in unchanged product code is a finding. Do not weaken the oracle or change product code without permission.

A model mutant that passes means the design check lost sensitivity, not that the code is safe. Keep the model self-tests separate from the real-source mutation exercise. Only make temporary product edits when permitted and when the file has no pre-existing changes. Reverse only that scratch diff and confirm status after each reversal.

## Tool setup

The model command requires Python 3.9+, Java 17+ and curl. It downloads TLA+ tools 1.7.4 from the versioned GitHub URL in `run.py`, checks SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`, and caches the jar in `~/.cache/nyte-verify/tla2tools-1.7.4.jar`. The checksum pins bytes, not a publisher signature. Temporary TLC files stay outside the repository and are removed after each run.

The network download has a 30-second limit and its subprocess a 35-second limit. History lookup has a 5-second limit; each TLC run has a 20-second limit and a 512 MB heap. These keep a normal complete invocation under two minutes. Exit 0 means all three design checks met their expected outcomes, 1 means an unexpected property result, and 2 means a tool failure. None of these exit codes claims to verify the TypeScript implementation. Run Vitest too.
