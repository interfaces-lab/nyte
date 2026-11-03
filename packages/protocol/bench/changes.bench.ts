import { changesSince } from "@nyte-ai/core";
import { emptyFold, fold } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { SessionEvent } from "@nyte-ai/schema";
import { recordLong } from "../test/sessions.ts";
import type { Recorded } from "../test/sessions.ts";

const SIZES = [100, 1_000, 10_000];

const REPETITIONS = 200;

const TURNS = 560;

const KINDS = ["land", "tool settlement", "run phase"] as const;

type Kind = (typeof KINDS)[number];

type Sample = {
  readonly kind: Kind;
  readonly event: number;
  readonly change: number;
  readonly tables: string;
};

const recorded = await recordLong(TURNS);

if (recorded.events.length < (SIZES.at(-1) ?? 0) + REPETITIONS)
  throw new Error(`The recorded session has only ${recorded.events.length} events.`);

for (const size of SIZES) measure(recorded, size);

const timings = SIZES.map((size) => ({ size, ...measure(recorded, size) }));

const ratio = (timings.at(-1)?.median ?? 0) / timings[0].median;

const scaled = ratio <= 2;

console.log(`events recorded: ${recorded.events.length}\n`);

console.log("prior events | median µs | p90 µs");

for (const timing of timings)
  console.log(
    [
      String(timing.size).padStart(12),
      micro(timing.median).padStart(9),
      micro(timing.p90).padStart(6),
    ].join(" | "),
  );

console.log(
  `${SIZES.at(-1)} / ${SIZES[0]}: ${ratio.toFixed(2)}× (gate 2×) ${scaled ? "pass" : "FAIL"}\n`,
);

console.log(
  "kind            | count | event B | change B | limit B | gate | tables of the worst change, B",
);

const sized = KINDS.map((kind) => {
  const samples = timings.flatMap((timing) =>
    timing.samples.filter((entry) => entry.kind === kind),
  );

  const worst = samples.reduce<Sample | null>(
    (found, entry) =>
      found === null || entry.change - limit(entry.event) > found.change - limit(found.event)
        ? entry
        : found,
    null,
  );

  const pass = worst !== null && worst.change <= limit(worst.event);

  console.log(
    [
      kind.padEnd(15),
      String(samples.length).padStart(5),
      String(worst?.event ?? 0).padStart(7),
      String(worst?.change ?? 0).padStart(8),
      String(Math.floor(limit(worst?.event ?? 0))).padStart(7),
      (pass ? "pass" : "FAIL").padEnd(4),
      worst?.tables ?? "",
    ].join(" | "),
  );

  return pass;
});

if (!scaled || sized.includes(false)) process.exitCode = 1;

function measure(log: Recorded, size: number) {
  let state = emptyFold({ session: log.session, principal: asId("local") });

  for (const event of log.events.slice(0, size)) state = fold(state, event);
  const times: number[] = [];
  const samples: Sample[] = [];

  for (const event of log.events.slice(size, size + REPETITIONS)) {
    const seq = state.seq;
    const started = performance.now();
    state = fold(state, event);
    const change = changesSince(state, seq);
    const encoded = JSON.stringify(change);
    times.push(performance.now() - started);

    const kind = classify(event);

    if (kind === null) continue;

    samples.push({
      kind,
      event: byteLength(JSON.stringify(event)),
      change: byteLength(encoded),
      tables: Object.entries(change.tables)
        .flatMap(([table, rows]) =>
          rows.upsert.length + rows.drop.length === 0
            ? []
            : [`${table} ${byteLength(JSON.stringify(rows))}`],
        )
        .join(", "),
    });
  }

  const sorted = times.toSorted((left, right) => left - right);

  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p90: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
    samples,
  };
}

function classify(event: SessionEvent): Kind | null {
  if (event.kind === "commit" && event.body.kind === "user") return "land";

  if (event.kind === "call" && event.change === "settled") return "tool settlement";

  return event.kind === "run" && event.change === "phase" ? "run phase" : null;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function limit(event: number): number {
  return event * 1.5 + 512;
}

function micro(milliseconds: number): string {
  return (milliseconds * 1000).toFixed(1);
}
