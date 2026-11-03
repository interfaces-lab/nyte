import { readFile } from "node:fs/promises";
import { changesSince } from "@nyte-ai/core";
import { emptyFold, fold } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { SessionEvent } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { recordLong, recordSessions } from "../test/sessions.ts";
import type { Recorded } from "../test/sessions.ts";

const SIZES = [100, 1_000, 10_000];

const REPETITIONS = 200;

const TURNS = 560;

const PRINCIPAL = asId<"principal">("local");

const KINDS = [
  "land/commit",
  "part created",
  "part updated",
  "call settled",
  "run phase",
  "input",
] as const;

type Kind = (typeof KINDS)[number];

const TOTALS_ONLY: ReadonlyMap<Kind, string> = new Map([
  [
    "part updated",
    "today's frame sends only the text appended to a streamed part; a change sends the whole row",
  ],
  ["input", "a path change names messages by id where today's frame used positions"],
]);

type Weighed = {
  readonly kind: Kind | null;
  readonly change: number;
};

const FramesSchema = Type.Object({
  count: Type.Number(),
  median: Type.Number(),
  total: Type.Number(),
});

const BaselineSchema = Type.Object({
  kinds: Type.Record(Type.String(), FramesSchema),
  logs: Type.Record(
    Type.String(),
    Type.Object({
      events: Type.Number(),
      total: Type.Number(),
      kinds: Type.Record(Type.String(), FramesSchema),
    }),
  ),
});

const baseline = Value.Parse(
  BaselineSchema,
  JSON.parse(await readFile(new URL("head-watch-frames.json", import.meta.url), "utf8")),
);

const long = await recordLong(TURNS);

if (long.events.length < (SIZES.at(-1) ?? 0) + REPETITIONS)
  throw new Error(`The recorded session has only ${long.events.length} events.`);

for (const size of SIZES) measure(long, size);

const timings = SIZES.map((size) => ({ size, ...measure(long, size) }));

const ratio = (timings.at(-1)?.median ?? 0) / timings[0].median;

const scaled = ratio <= 2;

console.log(`events recorded: ${long.events.length}\n`);

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

const logs = [...(await recordSessions()), long];

const weighed = logs.map((log) => ({ name: log.name, steps: weigh(log) }));

const steps = weighed.flatMap((log) => log.steps);

console.log("kind         | count | change B median | head.watch B median | gate");

const kinds = KINDS.map((kind) => {
  const sampled = steps.filter((step) => step.kind === kind);
  const change = median(sampled.map((step) => step.change));
  const frame = baseline.kinds[kind]?.median ?? 0;
  const reason = TOTALS_ONLY.get(kind);
  const pass = sampled.length > 0 && (reason !== undefined || change <= frame);

  console.log(
    [
      kind.padEnd(12),
      String(sampled.length).padStart(5),
      String(change).padStart(15),
      String(frame).padStart(19),
      pass ? (reason === undefined ? "pass" : `totals only: ${reason}`) : "FAIL",
    ].join(" | "),
  );

  return pass;
});

console.log("\nlog     | events | change B total | head.watch B total | gate");

const totals = weighed.map((log) => {
  const recorded = baseline.logs[log.name];

  if (recorded?.events !== log.steps.length)
    throw new Error(
      `The ${log.name} log has ${log.steps.length} events where head-watch-frames.json recorded ${recorded?.events ?? "none"}.`,
    );
  const change = sum(log.steps.map((step) => step.change));
  const frame = recorded.total;
  const pass = change <= frame;

  console.log(
    [
      log.name.padEnd(7),
      String(log.steps.length).padStart(6),
      String(change).padStart(14),
      String(frame).padStart(18),
      pass ? "pass" : "FAIL",
    ].join(" | "),
  );

  return pass;
});

if (!scaled || kinds.includes(false) || totals.includes(false)) process.exitCode = 1;

function measure(log: Recorded, size: number) {
  let state = emptyFold({ session: log.session, principal: PRINCIPAL });

  for (const event of log.events.slice(0, size)) state = fold(state, event);
  const times: number[] = [];

  for (const event of log.events.slice(size, size + REPETITIONS)) {
    const seq = state.seq;
    const started = performance.now();
    state = fold(state, event);
    JSON.stringify(changesSince(state, seq));
    times.push(performance.now() - started);
  }

  const sorted = times.toSorted((left, right) => left - right);

  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p90: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
  };
}

function weigh(log: Recorded): readonly Weighed[] {
  let state = emptyFold({ session: log.session, principal: PRINCIPAL });

  return log.events.map((event) => {
    const seq = state.seq;
    state = fold(state, event);

    return {
      kind: classify(event),
      change: byteLength(JSON.stringify(changesSince(state, seq))),
    };
  });
}

function classify(event: SessionEvent): Kind | null {
  if (event.kind === "commit") return "land/commit";

  if (event.kind === "input") return "input";

  if (event.kind === "part" && event.change === "created") return "part created";

  if (event.kind === "part" && event.change === "updated") return "part updated";

  if (event.kind === "call" && event.change === "settled") return "call settled";

  return event.kind === "run" && event.change === "phase" ? "run phase" : null;
}

function median(values: readonly number[]): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function micro(milliseconds: number): string {
  return (milliseconds * 1000).toFixed(1);
}
