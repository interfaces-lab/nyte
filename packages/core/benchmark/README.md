# Provider-free core benchmarks

Run from the repository root with installed workspace dependencies. The runner
uses TypeScript source directly. It creates synthetic data and fresh SQLite
stores under `/tmp`; it never opens a repository/session database, loads user
configuration, attaches a runner, or calls a provider.

```sh
# Small all-scenario validation, including a burst crossing 256 events.
pnpm exec node --test packages/core/benchmark/smoke.test.ts
pnpm exec bun test packages/core/benchmark/smoke.test.ts
pnpm exec node packages/core/benchmark/run.ts --suite all --sizes 100 --count 20 --events 300 --samples 1 --warmups 0 > /tmp/nyte-benchmark-smoke.json

# Bounded projection measurements: 12 rows, 3 samples and 1 warmup per row.
pnpm exec node packages/core/benchmark/run.ts --suite projections --sizes 100,1000,10000 --samples 3 --warmups 1 > /tmp/nyte-benchmark-node.json
pnpm exec bun packages/core/benchmark/run.ts --suite projections --sizes 100,1000,10000 --samples 3 --warmups 1 > /tmp/nyte-benchmark-bun.json

# Run storage/context/watch separately from the larger projection run.
pnpm exec node packages/core/benchmark/run.ts --suite histories --count 100 --samples 3 --warmups 1
pnpm exec node packages/core/benchmark/run.ts --suite sqlite --count 100 --samples 3 --warmups 1
pnpm exec node packages/core/benchmark/run.ts --suite watch --events 300 --samples 3 --warmups 1
```

The smoke suite passed all 4 tests on Node 26.7.0 and Bun 1.4.0.
`node:sqlite` compatibility is required for both runtimes. The runner uses
no Bun-only APIs. Run the smoke checks before collecting measurements on a
different runtime or source revision.

## Fixture shapes

Seed `nyte-core-j-v1`; commit epoch `1700000000000` ms, advancing 1 ms per
commit. IDs are SHA-256 hashes of real canonical commit bodies. Tool IDs and
paths use fixed counters. Each documented text field contains exactly 256
ASCII characters. Tool arguments and unified patch strings have their own
lengths, included in the constructed object payload.

| Projection workload | Commits per turn | Turn sequence | Tool pairs per turn |
| --- | ---: | --- | ---: |
| many-turns | 4 | user, assistant call, result, assistant answer | 1 |
| tool-heavy | 20 | user, 9 assistant call/result pairs, assistant answer | 9 |

Every call is `edit` with real old/new text arguments. Each successful result
carries a valid unified patch declaring 2 added and 1 removed line. Paths cycle
across 8 synthetic files. These are declared patch totals, not an applied
filesystem history. No filesystem tools execute.

| Commits | Many-turns turns / pairs / added / removed | Tool-heavy turns / pairs / added / removed |
| ---: | --- | --- |
| 100 | 25 / 25 / 50 / 25 | 5 / 45 / 90 / 45 |
| 1,000 | 250 / 250 / 500 / 250 | 50 / 450 / 900 / 450 |
| 10,000 | 2,500 / 2,500 / 5,000 / 2,500 | 500 / 4,500 / 9,000 / 4,500 |

`transcriptFromCommits` and `changesFromTurns` are timed separately. Changes
receives a prebuilt transcript. Checks outside timing compare expected turns,
text, durations, call identities, arguments, result commits, and per-file patch
totals. They also compare input values before and after projection. The small
smoke checks incremental agreement and preservation of previous transcript and
changes states, including repeated changes folds. No repeated incremental
10,000-commit fold runs in the measurement suite.

## Stored histories and snapshots

Histories and snapshots currently measure memory SQLite only. File WAL/FULL
measurements for these operations are outside this benchmark's current scope.

Both histories contain the same `N` synthetic user messages, including identical
message text and timestamps. The checkpoint variant inserts one portable
checkpoint after `floor(0.8 * N)` messages. Its summary is `Synthetic summary`;
its retained tail is the 4 immediately preceding messages. Later messages stay
on the branch. Inserting the checkpoint necessarily changes descendant parents,
hashes, and commit positions. All original message data remains equivalent.

For the default `N=100`:

| History | Stored commits | Checkpoint after | Retained message indices | Later messages | Context entries / messages |
| --- | ---: | ---: | --- | ---: | --- |
| without checkpoint | 100 | none | none | 100 | 100 / 100 |
| with checkpoint | 101 | 80 messages | 76 through 79 | 20 | 21 / 25 |

The context measurement includes `contextCommits`, then `contextMessages`, then
`modelContext` for the fixed synthetic model. It intentionally includes both
message projections and is labelled as that combined operation. The portable
checkpoint has no native provider material. Checks compare exact context
entries and message contents against independently constructed expectations.

The snapshot measurement calls **actual `nyte.sessions.snapshot`** over that
stored branch, with an inactive activation resolver and a fixed model catalog.
The required stream function throws if called. No plugins activate. Adoption,
initial snapshot construction, and activation resolution occur before timing,
including when warmups are zero. Snapshots still read and project the full
transcript across a checkpoint. The checkpoint only shortens model context.
Checks compare transcript contents, tip, cursor, pending items, repeat snapshot
values, and stored commit counts.

## SQLite and durable watch

`objects.put batch` inserts `N` distinct synthetic blobs into a newly created,
empty session/store for **every warmup and sample**. A put never reuses a
previous write target. The batch includes real canonicalization and SHA-256
hashing. `objects.get sequential batch, prepared statement primed` reads each
OID in order after one untimed get primes the existing statement cache. Reads
retain the real schema and hash validation. Expected OIDs, stored counts, and
all returned bodies are checked outside timing.

Put/get measurements have separate memory and fresh temporary file result rows.
`SqliteStore` configures `synchronous=FULL`; file stores use WAL, while SQLite
memory stores use the memory journal. The benchmark never changes integrity
settings. Settings metadata describes the existing constructor contract; the
private connection is not inspected. Temporary paths use unpredictable OS
suffixes, while session IDs and object payloads are deterministic. Stores close
and temporary directories are removed in `finally`.

Watch uses actual `session.events.append/read/watch` on a real memory store.
File WAL/FULL watch measurements are outside this benchmark's current scope.
The replay scenario seeds the complete notice burst before timing. The paused
consumer scenario consumes notice 1 outside timing, pauses at that yield,
appends notices 2 through N outside timing, then measures their delayed drain.
This exercises durable catch-up while a consumer is behind. The first notice
is excluded from the measured count. A 1 ms timer is awaited before every
32-event block; actual timer elapsed time is reported separately for each
sample and remains included in total duration. **Do not report this total as
raw event throughput**, or subtract it and claim an isolated backend cost.
Both paths collect observable events, then check exact durable contents,
ordering, completeness, uniqueness, and cancellation of a pending next call.
Each watch has a 10-second abort deadline; notice counts are capped at 1,024.
The default 300 notices exercises more than one current replay page without
asserting private page size or buffer behavior.

Event bodies are deterministic. The public append API owns event envelope
`at` timestamps, and store creation owns `createdAt`; those wall-clock values
cannot be injected. Checks compare them with the actual durable records.

## Output and interpretation

Normal stdout contains one JSON document with `schemaVersion: 1`, `status`,
resolved options, runtime/OS/architecture/CPU metadata, methodology, and result
rows. `runtime.sqlite` records `process.versions.sqlite`, or `null` when the
runtime does not provide it. CPU metadata is optional. Diagnostics go to stderr.
Help exits 0, argument errors exit 2, and operation or conformance failures
exit 1. No timing document is emitted on failure. The
CLI rejects unknown, duplicate, missing, and malformed flags at entry. It reads
no stdin or environment configuration. `--help` lists defaults and bounds.

Each row includes p50/p95 in milliseconds using nearest-rank quantiles, raw
sample durations, sample/warmup counts, fixture dimensions, and storage mode.
Three samples are a quick local observation: p95 is the maximum, not a robust
tail estimate. Warmup setup, fixture hashing, correctness checks, cleanup,
and metadata collection are outside the clock. Timings include the awaited
operation result and collection of that result; tiny synchronous projections
also include an await/microtask boundary. Checks between samples affect cache
and GC state. Read scenarios use warm stores, not cold OS caches.

`heapUsedDeltaBytes` is a noisy before/after heap-used delta proxy with no forced
GC. It includes result objects and may be negative. It measures neither total
allocations nor retained memory. Sample arrays retain timing scalars, not prior
operation outputs. No profiler runs during ordinary measurements.

Run metadata cannot isolate the effects of the bulk transcript builder,
prepared statement cache, SQLite hashing, or replay paging. Record the source
revision/worktree externally when comparing runs, since this runner never
reads Git or repository state.

Unavailable measurements: the public store exposes no prepared-cache on/off
switch, private paging/buffer metrics, or direct SDK runtime notification-fanout
publisher. Durable notice replay does not measure ephemeral plugin
notifications or runtime fanout. No cache-on/off, private buffer bound, or
notification-fanout claim is made. Native checkpoint production requires a
provider and is outside this batch; the stored portable checkpoint path is
measured instead.

Historical parent evidence was **10,000 user-only entries, 256 characters,
30 samples, 10 warmups, p50 30.510 ms on Node 26.7 / M4 Pro**. Neither mixed
projection fixture matches it. These results stand alone; do not claim a
percentage improvement against that number.

## Verification and separate profiling

These commands only target the new directory. The local TypeScript project
also follows imports into source and may report concurrent production errors;
do not hide those errors or edit other lanes to fix them.

```sh
pnpm exec tsc --noEmit -p packages/core/benchmark/tsconfig.json
pnpm exec oxlint packages/core/benchmark/*.ts
pnpm exec oxfmt --check packages/core/benchmark/*.ts packages/core/benchmark/tsconfig.json
```

Run profiling separately, writing artifacts under `/tmp`. Profiling output is
not interchangeable with the ordinary timing run.

```sh
pnpm exec node --cpu-prof --cpu-prof-dir=/tmp packages/core/benchmark/run.ts --suite projections --sizes 10000 --samples 3 --warmups 1 > /tmp/nyte-profile-run.json
pnpm exec node --heap-prof --heap-prof-dir=/tmp packages/core/benchmark/run.ts --suite projections --sizes 10000 --samples 3 --warmups 1 > /tmp/nyte-heap-profile-run.json
```

Package scripts can use `node packages/core/benchmark/run.ts` and
`node --test packages/core/benchmark/smoke.test.ts` from the repository root.
From `packages/core`, use `node benchmark/run.ts` and
`node --test benchmark/smoke.test.ts`. There is no generic scenario registry,
production adapter, package manifest change, or CI timing threshold.
