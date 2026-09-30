/**
 * The story the review plays: commit, CI, conflict, returned fix, merge.
 * Times are seconds from the first edit.
 */

export const ISSUE = {
  id: "NYT-482",
  title: "Pairing code expires while the Mac sleeps",
} as const;

export const HEAD = "fix/pairing-wake";
export const BASE = "main";
export const MERGE_REQUEST = {
  number: 311,
  title: "fix(desktop): refresh pairing code after wake",
} as const;
export const AGENT = { name: "Nyte", model: "claude-opus-4-8" } as const;
export const CHILD = { name: "Resolve conflict" } as const;
export const OTHER_SESSION = {
  title: "Inject clock into pairing",
  author: "Clock refactor",
} as const;

export const DURATION = 44;

const BASE_PAIRING = `import { randomCode } from "./random-code";

const CODE_TTL_MS = 5 * 60 * 1000;

export interface PairingCode {
  readonly value: string;
  readonly expiresAt: number;
}

export class Pairing {
  code: PairingCode;

  constructor() {
    this.code = this.issue();
  }

  start(): void {
    this.code = this.issue();
    setTimeout(() => (this.code = this.issue()), CODE_TTL_MS);
  }

  issue(): PairingCode {
    return { value: randomCode(), expiresAt: Date.now() + CODE_TTL_MS };
  }
}
`;

const WAKE_PAIRING = `import { powerMonitor } from "electron";
import { randomCode } from "./random-code";

const CODE_TTL_MS = 5 * 60 * 1000;

export interface PairingCode {
  readonly value: string;
  readonly expiresAt: number;
}

export class Pairing {
  code: PairingCode;

  constructor() {
    this.code = this.issue();
  }

  start(): void {
    this.code = this.issue();
    setInterval(() => this.refresh(), CODE_TTL_MS);
    powerMonitor.on("resume", () => this.refresh());
  }

  refresh(): void {
    if (this.code.expiresAt < Date.now()) this.code = this.issue();
  }

  issue(): PairingCode {
    return { value: randomCode(), expiresAt: Date.now() + CODE_TTL_MS };
  }
}
`;

const INCLUSIVE_PAIRING = WAKE_PAIRING.replace(
  "this.code.expiresAt < Date.now()",
  "this.code.expiresAt <= Date.now()",
);

const CLOCK_PAIRING = `import { randomCode } from "./random-code";
import { systemClock, type Clock } from "./system-clock";

const CODE_TTL_MS = 5 * 60 * 1000;

export interface PairingCode {
  readonly value: string;
  readonly expiresAt: number;
}

export class Pairing {
  code: PairingCode;
  readonly #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
    this.code = this.issue();
  }

  start(): void {
    this.code = this.issue();
    this.#clock.setTimeout(() => (this.code = this.issue()), CODE_TTL_MS);
  }

  issue(): PairingCode {
    return { value: randomCode(), expiresAt: this.#clock.now() + CODE_TTL_MS };
  }
}
`;

const RESOLVED_PAIRING = `import { powerMonitor } from "electron";
import { randomCode } from "./random-code";
import { systemClock, type Clock } from "./system-clock";

const CODE_TTL_MS = 5 * 60 * 1000;

export interface PairingCode {
  readonly value: string;
  readonly expiresAt: number;
}

export class Pairing {
  code: PairingCode;
  readonly #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
    this.code = this.issue();
  }

  start(): void {
    this.code = this.issue();
    this.#clock.setInterval(() => this.refresh(), CODE_TTL_MS);
    powerMonitor.on("resume", () => this.refresh());
  }

  refresh(): void {
    if (this.code.expiresAt <= this.#clock.now()) this.code = this.issue();
  }

  issue(): PairingCode {
    return { value: randomCode(), expiresAt: this.#clock.now() + CODE_TTL_MS };
  }
}
`;

const BASE_TEST = `import { describe, expect, it, vi } from "vitest";
import { Pairing } from "./pairing";

describe("pairing", () => {
  it("issues a six character code", () => {
    expect(new Pairing().code.value).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  it("rotates the code every five minutes", () => {
    vi.useFakeTimers();
    const pairing = new Pairing();
    pairing.start();
    const before = pairing.code.value;
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(pairing.code.value).not.toBe(before);
  });
});
`;

const WAKE_TEST = `import { powerMonitor } from "electron";
import { describe, expect, it, vi } from "vitest";
import { Pairing } from "./pairing";

describe("pairing", () => {
  it("issues a six character code", () => {
    expect(new Pairing().code.value).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  it("rotates the code every five minutes", () => {
    vi.useFakeTimers();
    const pairing = new Pairing();
    pairing.start();
    const before = pairing.code.value;
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(pairing.code.value).not.toBe(before);
  });

  it("refreshes an expired code on resume", () => {
    vi.useFakeTimers();
    const pairing = new Pairing();
    pairing.start();
    const before = pairing.code.value;
    vi.setSystemTime(pairing.code.expiresAt);
    powerMonitor.emit("resume");
    expect(pairing.code.value).not.toBe(before);
  });
});
`;

/** The follow-up the reviewer asks for from the side chat: the resume test drives the injected clock. */
const CLOCK_TEST = WAKE_TEST.replace(
  'import { Pairing } from "./pairing";',
  'import { Pairing } from "./pairing";\nimport { testClock } from "./system-clock";',
).replace(
  `    vi.useFakeTimers();
    const pairing = new Pairing();
    pairing.start();
    const before = pairing.code.value;
    vi.setSystemTime(pairing.code.expiresAt);`,
  `    const clock = testClock();
    const pairing = new Pairing(clock);
    pairing.start();
    const before = pairing.code.value;
    clock.set(pairing.code.expiresAt);`,
);

export const PAIRING_PATH = "packages/desktop/src/pairing.ts";
export const PAIRING_TEST_PATH = "packages/desktop/src/pairing.test.ts";

/** Every file the story touches, at every commit that can see it. */
const SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "7c21f0a": { [PAIRING_PATH]: BASE_PAIRING, [PAIRING_TEST_PATH]: BASE_TEST },
  a41c9e2: { [PAIRING_PATH]: WAKE_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
  c5e8d17: { [PAIRING_PATH]: INCLUSIVE_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
  b7d0f13: { [PAIRING_PATH]: CLOCK_PAIRING, [PAIRING_TEST_PATH]: BASE_TEST },
  e1f4b62: { [PAIRING_PATH]: RESOLVED_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
  f3a9c20: { [PAIRING_PATH]: RESOLVED_PAIRING, [PAIRING_TEST_PATH]: CLOCK_TEST },
};

/** Pushed from the side chat while you review; never on the clock. */
export const FOLLOW_UP = {
  oid: "f3a9c20",
  parent: "e1f4b62",
  subject: "test(desktop): drive the resume test through the injected clock",
  path: PAIRING_TEST_PATH,
} as const;

export type ReviewStatus = "waiting" | "in_review" | "changes_requested" | "approved";

/** The other rows in the Reviews list. Only !311 opens. */
export const OTHER_REVIEWS = [
  {
    number: 308,
    title: "fix(tui): restore scroll position after resize",
    group: "needs",
    status: "waiting",
    author: "Ada",
    age: "2h",
  },
  {
    number: 305,
    title: "fix(core): preserve tool errors across compaction",
    group: "needs",
    status: "waiting",
    author: "Nyte",
    age: "4h",
  },
  {
    number: 302,
    title: "refactor(app): share one Pierre preset",
    group: "reviewing",
    status: "in_review",
    author: "Min",
    age: "1d",
  },
  {
    number: 299,
    title: "fix(protocol): reject empty head names",
    group: "reviewing",
    status: "changes_requested",
    author: "Ada",
    age: "1d",
  },
] as const satisfies readonly {
  readonly number: number;
  readonly title: string;
  readonly group: "needs" | "reviewing";
  readonly status: ReviewStatus;
  readonly author: string;
  readonly age: string;
}[];

export const COMPLETED_REVIEWS = 47;

/** The file at a commit. Throws on a pair the story never has, which is a demo bug. */
export function fileAt(oid: string, path: string): string {
  const contents = SOURCES[oid]?.[path];

  if (contents === undefined) throw new Error(`No ${path} at ${oid}`);

  return contents;
}

export type LineKind = "context" | "add" | "remove";

export interface DiffLine {
  readonly kind: LineKind;
  readonly text: string;
  readonly old?: number;
  readonly new?: number;
}

/** A whole-file line diff (LCS), for demos that draw or animate lines by hand. */
export function diffLines(before: string, after: string): readonly DiffLine[] {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );

  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i];
      const below = table[i + 1];

      if (row === undefined || below === undefined) continue;

      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];

    if (left !== undefined && left === right) {
      lines.push({ kind: "context", text: left, old: i + 1, new: j + 1 });
      i++;
      j++;
    } else if (
      right !== undefined &&
      (left === undefined || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))
    ) {
      lines.push({ kind: "add", text: right, new: j + 1 });
      j++;
    } else if (left !== undefined) {
      lines.push({ kind: "remove", text: left, old: i + 1 });
      i++;
    }
  }

  return lines;
}

export interface Patch {
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

const CONTEXT_LINES = 3;

/** One file between two commits of the story, as the unified diff git prints. */
export function patchBetween(from: string, to: string, path: string): Patch | undefined {
  const lines = diffLines(fileAt(from, path), fileAt(to, path));
  const changed = lines.flatMap((line, index) => (line.kind === "context" ? [] : [index]));
  const first = changed[0];

  if (first === undefined) return undefined;

  const groups: [number, number][] = [[first, first]];

  for (const index of changed.slice(1)) {
    const last = groups.at(-1);

    if (last !== undefined && index - last[1] <= CONTEXT_LINES * 2) last[1] = index;
    else groups.push([index, index]);
  }

  const hunks = groups.map(([low, high]) => {
    const slice = lines.slice(Math.max(0, low - CONTEXT_LINES), high + CONTEXT_LINES + 1);
    const oldCount = slice.filter((line) => line.kind !== "add").length;
    const newCount = slice.filter((line) => line.kind !== "remove").length;
    const oldStart = slice.find((line) => line.old !== undefined)?.old ?? 0;
    const newStart = slice.find((line) => line.new !== undefined)?.new ?? 0;
    const body = slice.map(
      (line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`,
    );

    return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join("\n");
  });

  return {
    patch: [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks, ""].join(
      "\n",
    ),
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "remove").length,
  };
}

export interface Commit {
  readonly oid: string;
  readonly subject: string;
  readonly on: "main" | "head";
  readonly parent: string;
  /** Cross-branch provenance. Never context: the kernel carries it beside the parent. */
  readonly imports?: readonly string[];
  readonly at: number;
  readonly author: string;
  readonly files: readonly string[];
  readonly stat: string;
}

export const COMMITS = [
  {
    oid: "7c21f0a",
    subject: "chore: release 0.0.10-dev.1",
    on: "main",
    parent: "3be90d4",
    at: -1,
    author: "release",
    files: [],
    stat: "",
  },
  {
    oid: "a41c9e2",
    subject: "fix(desktop): refresh pairing code after wake",
    on: "head",
    parent: "7c21f0a",
    at: 3,
    author: AGENT.name,
    files: [PAIRING_PATH, PAIRING_TEST_PATH],
    stat: "+18 −1",
  },
  {
    oid: "c5e8d17",
    subject: "fix(desktop): treat a code as expired at its deadline",
    on: "head",
    parent: "a41c9e2",
    at: 17,
    author: AGENT.name,
    files: [PAIRING_PATH],
    stat: "+1 −1",
  },
  {
    oid: "b7d0f13",
    subject: "refactor(desktop): inject clock into pairing",
    on: "main",
    parent: "7c21f0a",
    at: 22,
    author: OTHER_SESSION.author,
    files: [PAIRING_PATH],
    stat: "+6 −3",
  },
  {
    oid: "e1f4b62",
    subject: "fix(desktop): carry pairing wake fix onto injected clock",
    on: "head",
    parent: "b7d0f13",
    imports: ["a41c9e2", "c5e8d17"],
    at: 33,
    author: CHILD.name,
    files: [PAIRING_PATH, PAIRING_TEST_PATH],
    stat: "+18 −1",
  },
] as const satisfies readonly Commit[];

export type JobOutcome = "passed" | "failed" | "skipped";
export type JobState = "queued" | "running" | JobOutcome;

export interface Job {
  readonly name: string;
  /** Seconds after the pipeline starts. */
  readonly start: number;
  readonly duration: number;
  readonly outcome: JobOutcome;
  readonly took: string;
}

export interface Pipeline {
  readonly number: number;
  readonly commit: string;
  readonly at: number;
  readonly jobs: readonly Job[];
}

export const PIPELINES = [
  {
    number: 1,
    commit: "a41c9e2",
    at: 5,
    jobs: [
      { name: "typecheck", start: 0, duration: 4, outcome: "passed", took: "41s" },
      { name: "lint", start: 0, duration: 2, outcome: "passed", took: "14s" },
      { name: "test core", start: 0.5, duration: 6, outcome: "passed", took: "1m 12s" },
      { name: "test desktop", start: 0.5, duration: 7.5, outcome: "failed", took: "38s" },
      { name: "build", start: 8, duration: 0, outcome: "skipped", took: "—" },
    ],
  },
  {
    number: 2,
    commit: "c5e8d17",
    at: 18,
    jobs: [
      { name: "typecheck", start: 0, duration: 3.5, outcome: "passed", took: "39s" },
      { name: "lint", start: 0, duration: 2, outcome: "passed", took: "13s" },
      { name: "test core", start: 0.5, duration: 5.5, outcome: "passed", took: "1m 09s" },
      { name: "test desktop", start: 0.5, duration: 4.5, outcome: "passed", took: "36s" },
      { name: "build", start: 6, duration: 2, outcome: "passed", took: "1m 03s" },
    ],
  },
  {
    number: 3,
    commit: "e1f4b62",
    at: 34,
    jobs: [
      { name: "typecheck", start: 0, duration: 3.5, outcome: "passed", took: "40s" },
      { name: "lint", start: 0, duration: 2, outcome: "passed", took: "13s" },
      { name: "test core", start: 0.5, duration: 5, outcome: "passed", took: "1m 10s" },
      { name: "test desktop", start: 0.5, duration: 4, outcome: "passed", took: "35s" },
      { name: "build", start: 5.5, duration: 2, outcome: "passed", took: "1m 01s" },
    ],
  },
] as const satisfies readonly Pipeline[];

export function jobState(pipeline: Pipeline, job: Job, time: number): JobState {
  const local = time - pipeline.at;

  if (local < job.start) return "queued";
  if (job.outcome === "skipped") return "skipped";
  if (local < job.start + job.duration) return "running";

  return job.outcome;
}

export function pipelineState(pipeline: Pipeline, time: number): JobState {
  const states = pipeline.jobs.map((job) => jobState(pipeline, job, time));

  if (states.includes("failed")) return "failed";
  if (states.every((state) => state === "passed" || state === "skipped")) return "passed";
  if (states.every((state) => state === "queued")) return "queued";

  return "running";
}

/** Where each branch tip points at `time`. */
export function tipsAt(time: number): { readonly main: string; readonly head: string } {
  const main = time >= 42 ? "e1f4b62" : time >= 22 ? "b7d0f13" : "7c21f0a";
  const head =
    COMMITS.findLast((commit) => commit.at <= time && commit.on === "head")?.oid ?? "7c21f0a";

  return { main, head };
}
