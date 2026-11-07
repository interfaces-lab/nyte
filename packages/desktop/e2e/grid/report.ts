import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCause } from "./cause.ts";
import type { Cause, SourceIndex, SourceRef } from "./cause.ts";
import { LINE_TOLERANCE } from "./check.ts";
import type { CheckResult, Finding } from "./check.ts";
import type { Rect, Snapshot } from "./collect.ts";
import type { Mark } from "./overlay.ts";
import { GRID_RULES, SCALE } from "./rules.ts";
import type { RegionName, RuleId } from "./rules.ts";

export interface ElementRef {
  readonly tag: string;
  readonly slot: string | null;
  readonly role: string | null;
  readonly name: string;
  readonly key: string;
}

export interface Violation {
  readonly n: number;
  readonly id: string;
  readonly state: string;
  readonly region: RegionName | "window";
  readonly element: ElementRef;
  readonly rule: RuleId;
  readonly property: string;
  readonly value: string;
  readonly expected: string;
  readonly box: Rect;
  readonly target: Finding["target"];
  readonly cause: Cause;
}

export interface StateResult {
  readonly state: string;
  readonly score: number;
  readonly fonts: Snapshot["fonts"];
  readonly viewport: Snapshot["viewport"];
  readonly violations: readonly Violation[];
  readonly masked: readonly MaskedMiss[];
  readonly exceptionHits: Readonly<Record<string, number>>;
  readonly centring: readonly number[];
}

interface WindowSizes {
  readonly main: { readonly width: number; readonly height: number };
  readonly narrow: { readonly width: number; readonly height: number };
  readonly workArea: { readonly width: number; readonly height: number };
  readonly scale: number;
}

interface Build {
  readonly head: string;
  readonly changedFiles: number;
}

const ORDER: readonly RuleId[] = [
  "spacing",
  "box-grid",
  "control-size",
  "bar-size",
  "radius",
  "icon-size",
  "type-pair",
  "half-pixel",
  "rail",
  "rhythm",
  "align",
  "end-in-view",
];

export interface MaskedMiss {
  readonly id: string;
  readonly rule: RuleId;
  readonly region: RegionName | "window";
  readonly key: string;
  readonly property: string;
  readonly value: string;
}

export function stateResult(input: {
  readonly state: string;
  readonly snapshot: Snapshot;
  readonly checked: CheckResult;
  readonly index: SourceIndex;
}): StateResult {
  const keyOfBox = (finding: Finding): string => input.snapshot.boxes[finding.box]?.key ?? "";

  const ids = violationIds(
    input.state,
    [...input.checked.findings, ...input.checked.masked],
    keyOfBox,
  );

  const sorted = [...input.checked.findings].sort(compareFindings);

  const violations = sorted.map((finding, position): Violation => {
    const box = input.snapshot.boxes[finding.box];

    return {
      n: position + 1,
      id: ids.get(finding) ?? "",
      state: input.state,
      region: finding.region,
      element: {
        tag: box?.tag ?? "",
        slot: box?.slot ?? null,
        role: box?.role ?? null,
        name: box?.name ?? "",
        key: box?.key ?? "",
      },
      rule: finding.rule,
      property: finding.property,
      value: finding.value,
      expected: finding.expected,
      box: finding.rect,
      target: finding.target,
      cause: resolveCause(input.index, input.snapshot, finding.cause),
    };
  });

  const masked = [...input.checked.masked]
    .map((finding) => ({
      id: ids.get(finding) ?? "",
      rule: finding.rule,
      region: finding.region,
      key: keyOfBox(finding),
      property: finding.property,
      value: finding.value,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    state: input.state,
    score: violations.length,
    fonts: input.snapshot.fonts,
    viewport: input.snapshot.viewport,
    violations,
    masked,
    exceptionHits: Object.fromEntries(
      [...input.checked.exceptionHits].sort(([a], [b]) => a.localeCompare(b)),
    ),
    centring: input.checked.centring,
  };
}

function violationIds(
  state: string,
  findings: readonly Finding[],
  keyOfBox: (finding: Finding) => string,
): Map<Finding, string> {
  const bases = new Map<string, Finding[]>();

  for (const finding of findings) {
    const base = createHash("sha1")
      .update([state, finding.rule, finding.region, keyOfBox(finding), finding.property].join("|"))
      .digest("hex")
      .slice(0, 10);

    bases.set(base, [...(bases.get(base) ?? []), finding]);
  }

  return new Map(
    [...bases].flatMap(([base, shared]) =>
      [...shared]
        .sort((a, b) => a.detail.localeCompare(b.detail) || a.box - b.box)
        .map(
          (finding, ordinal) =>
            [finding, ordinal === 0 ? base : `${base}-${String(ordinal)}`] as const,
        ),
    ),
  );
}

export function overlayMarks(result: StateResult): Mark[] {
  return result.violations.map((violation) => ({
    label: `${String(violation.n)} ${violation.rule}`,
    rect: violation.box,
    target: violation.target,
  }));
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    a.region.localeCompare(b.region) ||
    ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) ||
    a.rect.top - b.rect.top ||
    a.rect.left - b.rect.left ||
    a.property.localeCompare(b.property) ||
    a.box - b.box
  );
}

const where = (ref: SourceRef | null): string =>
  ref === null ? "no source line" : `${ref.path}:${String(ref.line)}`;

function causeKey(cause: Cause): string {
  switch (cause.kind) {
    case "token":
      return `${cause.token}  ${where(cause.chain[0]?.defined ?? null)} <- ${where(cause.use)}`;
    case "literal":
      return `literal ${cause.declaration}  ${where(cause.use)}`;
    case "missing":
      return `missing rail term ${cause.term}  ${where(cause.at)}`;
    case "unresolved":
      return `unresolved: ${cause.reason.replace(/-?[\d.]+px/gu, "N px")}`;
    default: {
      const exhaustive: never = cause;

      return exhaustive;
    }
  }
}

const tally = (keys: readonly string[]): [string, number][] => {
  const counts = new Map<string, number>();

  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export async function writeReport(input: {
  readonly out: string;
  readonly build: Build;
  readonly window: WindowSizes;
  readonly states: readonly StateResult[];
}): Promise<string> {
  await mkdir(input.out, { recursive: true });
  const all = input.states.flatMap((state) => state.violations);
  const score = all.length;
  const centring = input.states.flatMap((state) => state.centring);
  const offCentre = centring.filter((error) => error !== 0);

  const exceptionHits = tally(
    input.states.flatMap((state) =>
      Object.entries(state.exceptionHits).flatMap(([name, count]) =>
        Array.from({ length: count }, () => name),
      ),
    ),
  );

  const report = {
    build: input.build,
    window: input.window,
    media: "prefers-reduced-motion: reduce",
    scale: SCALE,
    rules: GRID_RULES,
    rhythm: {
      tolerance: LINE_TOLERANCE,
      rows: centring.length,
      offCentre: offCentre.length,
      spread: centring.length === 0 ? [0, 0] : [Math.min(...centring), Math.max(...centring)],
    },
    score,
    byRule: Object.fromEntries(tally(all.map((violation) => violation.rule))),
    byRegion: Object.fromEntries(tally(all.map((violation) => violation.region))),
    causes: tally(all.map((violation) => causeKey(violation.cause))).map(([cause, count]) => ({
      cause,
      count,
    })),
    exceptionHits: Object.fromEntries(exceptionHits),
    states: input.states,
  };

  await writeFile(join(input.out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);

  const width = Math.max(...input.states.map((state) => state.state.length));

  const lines = [
    `grid: ${String(input.states.length)} states, ${input.build.head}, ${String(input.build.changedFiles)} changed files`,
    `window: ${String(input.window.main.width)}×${String(input.window.main.height)} and ${String(input.window.narrow.width)}×${String(input.window.narrow.height)} at ${String(input.window.scale)}x, work area ${String(input.window.workArea.width)}×${String(input.window.workArea.height)}`,
    `rhythm: ${String(offCentre.length)} of ${String(centring.length)} rows off centre, spread ${report.rhythm.spread.join(" to ")}px`,
    "",
    ...input.states.map((state) => {
      const rules = tally(state.violations.map((violation) => violation.rule))
        .map(([rule, count]) => `${rule} ${String(count)}`)
        .join(", ");

      return `${state.state.padEnd(width)}  ${String(state.score).padStart(4)}  ${rules}`;
    }),
    "",
    "by region",
    ...tally(all.map((violation) => violation.region)).map(
      ([region, count]) => `${String(count).padStart(5)}  ${region}`,
    ),
    "",
    "top causes",
    ...report.causes
      .slice(0, 10)
      .map((entry) => `${String(entry.count).padStart(5)}  ${entry.cause}`),
    "",
    "exceptions applied",
    ...(exceptionHits.length === 0
      ? ["    0"]
      : exceptionHits.map(([name, count]) => `${String(count).padStart(5)}  ${name}`)),
    "",
    "files: report.json, summary.txt, <state>.png with numbered violations, <state>-plain.png, <state>.snapshot.json",
    `score: ${String(score)}`,
  ];

  const summary = `${lines.join("\n")}\n`;
  await writeFile(join(input.out, "summary.txt"), summary);

  return summary;
}
