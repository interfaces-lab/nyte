import { changesSince } from "@nyte-ai/core";
import { emptyFold, fold, project } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { SessionEvent, SessionView, ViewFrame } from "@nyte-ai/schema";
import { viewFrames } from "../src/view-frames.ts";
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

type Weighed = {
  readonly kind: Kind | null;
  readonly change: number;
  readonly frame: number;
};

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

const weighed = await Promise.all(
  logs.map(async (log) => ({ name: log.name, steps: await weigh(log) })),
);

const steps = weighed.flatMap((log) => log.steps);

console.log("kind         | count | change B median | head.watch B median | gate");

const kinds = KINDS.map((kind) => {
  const sampled = steps.filter((step) => step.kind === kind);
  const change = median(sampled.map((step) => step.change));
  const frame = median(sampled.map((step) => step.frame));
  const pass = sampled.length > 0 && change <= frame;

  console.log(
    [
      kind.padEnd(12),
      String(sampled.length).padStart(5),
      String(change).padStart(15),
      String(frame).padStart(19),
      pass ? "pass" : "FAIL",
    ].join(" | "),
  );

  return pass;
});

console.log("\nlog     | events | change B total | head.watch B total | gate");

const totals = weighed.map((log) => {
  const change = sum(log.steps.map((step) => step.change));
  const frame = sum(log.steps.map((step) => step.frame));
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

async function weigh(log: Recorded): Promise<readonly Weighed[]> {
  let state = emptyFold({ session: log.session, principal: PRINCIPAL });

  const watches = log.heads.map((head) => {
    const views = async function* (): AsyncGenerator<SessionView> {
      for (let step = 0; step <= log.events.length; step += 1) yield project(state, head);
    };

    return viewFrames(views())[Symbol.asyncIterator]();
  });

  await framed(watches);
  const steps: Weighed[] = [];

  for (const event of log.events) {
    const seq = state.seq;
    state = fold(state, event);
    const change = byteLength(JSON.stringify(changesSince(state, seq)));
    steps.push({ kind: classify(event), change, frame: await framed(watches) });
  }

  return steps;
}

async function framed(watches: readonly AsyncIterator<ViewFrame>[]): Promise<number> {
  const frames = await Promise.all(watches.map((watch) => watch.next()));

  return sum(
    frames.map((frame) => (frame.done === true ? 0 : byteLength(JSON.stringify(frame.value)))),
  );
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
