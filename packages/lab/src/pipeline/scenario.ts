/**
 * One story, told ten ways. Every demo on the Pipeline page plays this
 * scenario and nothing else, so the comparison is about the telling.
 *
 * Times are demo seconds from the first edit. Kernel refs are the real ref
 * layout from `packages/core/src/kernel/README.md`.
 */

export const ISSUE = {
  id: "NYT-482",
  title: "Pairing code expires while the Mac sleeps",
  project: "Desktop",
} as const;

export const REPO = "nyte-ai/nyte";
export const HEAD = "fix/pairing-wake";
export const BASE = "main";
export const MERGE_REQUEST = { number: 311, title: "fix(desktop): refresh pairing code after wake" } as const;
export const AGENT = { name: "Nyte", model: "claude-opus-4-8", run: "run-7" } as const;
export const CHILD = { name: "Resolve conflict", head: "fix/pairing-wake~resolve" } as const;
export const OTHER_SESSION = { title: "Inject clock into pairing", author: "Clock refactor" } as const;

export const DURATION = 44;

export const STAGES = [
  { id: "commit", label: "Commit", at: 0 },
  { id: "checks", label: "CI/CD", at: 5 },
  { id: "conflict", label: "Conflict", at: 27 },
  { id: "fix", label: "Return fix", at: 30 },
  { id: "merged", label: "Merged", at: 42 },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

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

/** What \`git merge\` leaves in the worktree: one textual conflict, one silent one. */
const CONFLICTED_PAIRING = `import { powerMonitor } from "electron";
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
<<<<<<< ${HEAD}
    setInterval(() => this.refresh(), CODE_TTL_MS);
    powerMonitor.on("resume", () => this.refresh());
=======
    this.#clock.setTimeout(() => (this.code = this.issue()), CODE_TTL_MS);
>>>>>>> ${BASE}
  }

  refresh(): void {
    if (this.code.expiresAt <= Date.now()) this.code = this.issue();
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

export const PAIRING_PATH = "packages/desktop/src/pairing.ts";
export const PAIRING_TEST_PATH = "packages/desktop/src/pairing.test.ts";

/** Every file the story touches, at every commit that can see it. */
const SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "7c21f0a": { [PAIRING_PATH]: BASE_PAIRING, [PAIRING_TEST_PATH]: BASE_TEST },
  a41c9e2: { [PAIRING_PATH]: WAKE_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
  c5e8d17: { [PAIRING_PATH]: INCLUSIVE_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
  b7d0f13: { [PAIRING_PATH]: CLOCK_PAIRING, [PAIRING_TEST_PATH]: BASE_TEST },
  e1f4b62: { [PAIRING_PATH]: RESOLVED_PAIRING, [PAIRING_TEST_PATH]: WAKE_TEST },
};

/** The file at a commit. Throws on a pair the story never has, which is a demo bug. */
export function fileAt(oid: string, path: string): string {
  const contents = SOURCES[oid]?.[path];

  if (contents === undefined) throw new Error(`No ${path} at ${oid}`);

  return contents;
}

/** Ready for Pierre's \`MultiFileDiff\`: \`<MultiFileDiff {...fileDiffInput(a, b, path)} />\`. */
export function fileDiffInput(
  from: string,
  to: string,
  path: string,
): {
  readonly oldFile: { readonly name: string; readonly contents: string; readonly cacheKey: string };
  readonly newFile: { readonly name: string; readonly contents: string; readonly cacheKey: string };
} {
  return {
    oldFile: { name: path, contents: fileAt(from, path), cacheKey: `${from}:${path}` },
    newFile: { name: path, contents: fileAt(to, path), cacheKey: `${to}:${path}` },
  };
}

/** Ready for Pierre's \`UnresolvedFile\`: the worktree mid-merge, with markers. */
export const CONFLICTED_FILE = {
  name: PAIRING_PATH,
  contents: CONFLICTED_PAIRING,
  cacheKey: `conflict:${PAIRING_PATH}`,
} as const;

export type LineKind = "context" | "add" | "remove";

export interface DiffLine {
  readonly kind: LineKind;
  readonly text: string;
  readonly old?: number;
  readonly new?: number;
}

/** A whole-file line diff (LCS), for demos that draw or animate lines by hand. */
export function diffLines(before: string, after: string): readonly DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

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
    stat: "+17 −1",
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
    stat: "+7 −3",
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
    stat: "+17 −2",
  },
] as const satisfies readonly Commit[];

/** The textual conflict, three ways, and the semantic one git cannot see. */
export const CONFLICT = {
  path: PAIRING_PATH,
  /** Where the markers open in \`CONFLICTED_FILE\`, and where the resolution lands. */
  line: 23,
  base: ["    setTimeout(() => (this.code = this.issue()), CODE_TTL_MS);"],
  ours: [
    "    setInterval(() => this.refresh(), CODE_TTL_MS);",
    '    powerMonitor.on("resume", () => this.refresh());',
  ],
  theirs: ["    this.#clock.setTimeout(() => (this.code = this.issue()), CODE_TTL_MS);"],
  resolved: [
    "    this.#clock.setInterval(() => this.refresh(), CODE_TTL_MS);",
    '    powerMonitor.on("resume", () => this.refresh());',
  ],
  /** Merges cleanly and is still wrong: refresh() reads the wall clock main just removed. */
  silent: {
    /** In \`CONFLICTED_FILE\`; line 28 once resolved. */
    line: 32,
    before: "    if (this.code.expiresAt <= Date.now()) this.code = this.issue();",
    after: "    if (this.code.expiresAt <= this.#clock.now()) this.code = this.issue();",
  },
  reason: "Keep main's injected clock and this branch's refresh on wake.",
} as const;

export type JobOutcome = "passed" | "failed" | "skipped";
export type JobState = "queued" | "running" | JobOutcome;

export interface Job {
  readonly name: string;
  /** Seconds after the pipeline starts. */
  readonly start: number;
  readonly duration: number;
  readonly outcome: JobOutcome;
  /** What the runner reports, for the log. */
  readonly took: string;
}

export interface Pipeline {
  readonly number: number;
  readonly commit: string;
  readonly at: number;
  readonly jobs: readonly Job[];
  readonly log?: readonly string[];
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
    log: [
      " ✓ pairing › issues a six character code",
      " ✓ pairing › rotates the code every five minutes",
      " ✗ pairing › refreshes an expired code on resume",
      "",
      "   AssertionError: expected 'K7Q-29X' not to be 'K7Q-29X'",
      "   ❯ src/pairing.test.ts:26:37",
      "",
      " Test Files  1 failed | 11 passed (12)",
      "      Tests  1 failed | 86 passed (87)",
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

export type Actor = "agent" | "child" | "ci" | "kernel" | "main" | "user";

export interface PipelineEvent {
  readonly at: number;
  readonly stage: StageId;
  readonly actor: Actor;
  readonly title: string;
  readonly detail?: string;
  /** The kernel ref this event moves or reads. */
  readonly ref?: string;
}

export const EVENTS = [
  { at: 0, stage: "commit", actor: "agent", title: "Edited pairing.ts", detail: "+10 −1" },
  { at: 1.5, stage: "commit", actor: "agent", title: "Edited pairing.test.ts", detail: "+9" },
  {
    at: 3,
    stage: "commit",
    actor: "kernel",
    title: "Committed a41c9e2",
    detail: "7c21f0a → a41c9e2",
    ref: `refs/heads/${HEAD}`,
  },
  {
    at: 4,
    stage: "commit",
    actor: "agent",
    title: `Opened !${MERGE_REQUEST.number} into ${BASE}`,
    detail: MERGE_REQUEST.title,
  },
  {
    at: 5,
    stage: "checks",
    actor: "kernel",
    title: "Waiting on pipeline #1",
    detail: "intent → waiting",
    ref: `refs/effects/${AGENT.run}/ci-1`,
  },
  { at: 13, stage: "checks", actor: "ci", title: "test desktop failed", detail: "1 of 87 tests" },
  {
    at: 13.5,
    stage: "checks",
    actor: "kernel",
    title: "Pipeline #1 signalled failure",
    detail: "waiting → signal",
    ref: `refs/effects/${AGENT.run}/ci-1`,
  },
  { at: 14, stage: "checks", actor: "agent", title: "Read the job log", detail: "pairing.test.ts:26" },
  {
    at: 15.5,
    stage: "checks",
    actor: "agent",
    title: "Edited pairing.ts",
    detail: "expired at the deadline, not after it",
  },
  {
    at: 17,
    stage: "checks",
    actor: "kernel",
    title: "Committed c5e8d17",
    detail: "a41c9e2 → c5e8d17",
    ref: `refs/heads/${HEAD}`,
  },
  {
    at: 18,
    stage: "checks",
    actor: "kernel",
    title: "Waiting on pipeline #2",
    detail: "intent → waiting",
    ref: `refs/effects/${AGENT.run}/ci-2`,
  },
  {
    at: 22,
    stage: "checks",
    actor: "main",
    title: "main moved to b7d0f13",
    detail: `${OTHER_SESSION.title}, from another session`,
    ref: "refs/heads/main",
  },
  { at: 26, stage: "checks", actor: "ci", title: "Pipeline #2 passed", detail: "5 of 5 jobs" },
  { at: 27, stage: "conflict", actor: "agent", title: `Merging !${MERGE_REQUEST.number}` },
  {
    at: 27.5,
    stage: "conflict",
    actor: "kernel",
    title: "Merge rejected",
    detail: "expected main at 7c21f0a, found b7d0f13",
    ref: "refs/heads/main",
  },
  {
    at: 28.5,
    stage: "conflict",
    actor: "kernel",
    title: "Branch is stale",
    detail: "parent 7c21f0a is behind main",
    ref: `refs/stacks/${HEAD}`,
  },
  { at: 29, stage: "conflict", actor: "agent", title: "Conflict in pairing.ts", detail: "1 hunk, line 23" },
  {
    at: 30,
    stage: "fix",
    actor: "kernel",
    title: `Delegated "${CHILD.name}"`,
    detail: "child session, reports back to run-7",
    ref: `refs/delegations/${CHILD.head}/chg-4`,
  },
  { at: 31, stage: "fix", actor: "child", title: "Read b7d0f13 and c5e8d17" },
  { at: 32, stage: "fix", actor: "child", title: "Resolved pairing.ts:23", detail: CONFLICT.reason },
  {
    at: 33,
    stage: "fix",
    actor: "kernel",
    title: "Committed e1f4b62",
    detail: "parent b7d0f13 · imports a41c9e2, c5e8d17",
    ref: `refs/heads/${HEAD}`,
  },
  {
    at: 34,
    stage: "fix",
    actor: "kernel",
    title: "Waiting on pipeline #3",
    detail: "intent → waiting",
    ref: `refs/effects/${AGENT.run}/ci-3`,
  },
  { at: 41.5, stage: "fix", actor: "ci", title: "Pipeline #3 passed", detail: "5 of 5 jobs" },
  {
    at: 42,
    stage: "merged",
    actor: "kernel",
    title: "Fast-forwarded main",
    detail: "b7d0f13 → e1f4b62",
    ref: "refs/heads/main",
  },
  { at: 43, stage: "merged", actor: "agent", title: `Closed ${ISSUE.id}` },
] as const satisfies readonly PipelineEvent[];

export function stageAt(time: number): StageId {
  let current: StageId = "commit";

  for (const stage of STAGES) if (stage.at <= time) current = stage.id;

  return current;
}

export function eventsUntil(time: number): readonly PipelineEvent[] {
  return EVENTS.filter((event) => event.at <= time);
}

export function commitsUntil(time: number): readonly Commit[] {
  return COMMITS.filter((commit) => commit.at <= time);
}

/** The pipeline running or last finished at `time`, if any has started. */
export function pipelineAt(time: number): Pipeline | undefined {
  return PIPELINES.findLast((pipeline) => pipeline.at <= time);
}

export function jobState(pipeline: Pipeline, job: Job, time: number): JobState {
  const local = time - pipeline.at;

  if (local < job.start) return "queued";
  if (job.outcome === "skipped") return "skipped";
  if (local < job.start + job.duration) return "running";

  return job.outcome;
}

/** 0 to 1 through the job's run, for progress bars. */
export function jobProgress(pipeline: Pipeline, job: Job, time: number): number {
  if (job.duration === 0) return time - pipeline.at >= job.start ? 1 : 0;

  return Math.min(1, Math.max(0, (time - pipeline.at - job.start) / job.duration));
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
  const head = commitsUntil(time).findLast((commit) => commit.on === "head")?.oid ?? "7c21f0a";

  return { main, head };
}
