/**
 * `pnpm --dir packages/desktop grid:diff <before> <after>` pairs two grid reports' violations by id and
 * labels each one removed, kept, added or revealed. Revealed is a miss the before report masked behind
 * a reported one, at the same value, that shows once the cover is fixed; it isn't new. Exits 1 when
 * anything is added.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const Miss = Type.Object({
  id: Type.String(),
  rule: Type.String(),
  region: Type.String(),
  property: Type.String(),
  value: Type.String(),
});

const Report = Type.Object({
  score: Type.Number(),
  states: Type.Array(
    Type.Object({
      state: Type.String(),
      violations: Type.Array(
        Type.Object({
          ...Miss.properties,
          expected: Type.String(),
          element: Type.Object({ key: Type.String() }),
        }),
      ),
      masked: Type.Array(Type.Object({ ...Miss.properties, key: Type.String() })),
    }),
  ),
});

type Label = "removed" | "kept" | "added" | "revealed";

const LABELS: readonly Label[] = ["removed", "kept", "added", "revealed"];

interface Paired {
  readonly label: Label;
  readonly state: string;
  readonly line: string;
  /** A kept violation whose value or expected value moved, such as an alignment that shifted with the titlebar. */
  readonly changed: boolean;
}

function readReport(directory: string): Static<typeof Report> {
  return Value.Parse(Report, JSON.parse(readFileSync(join(directory, "report.json"), "utf8")));
}

function pair(before: Static<typeof Report>, after: Static<typeof Report>): Paired[] {
  const states = [...new Set([...before.states, ...after.states].map((entry) => entry.state))];

  return states.flatMap((state) => {
    const was = before.states.find((entry) => entry.state === state);
    const now = after.states.find((entry) => entry.state === state);
    const wasIds = new Map((was?.violations ?? []).map((violation) => [violation.id, violation]));
    const nowIds = new Set((now?.violations ?? []).map((violation) => violation.id));
    const masked = new Map((was?.masked ?? []).map((miss) => [miss.id, miss]));

    const current = (now?.violations ?? []).map((violation): Paired => {
      const line = `${violation.rule} ${violation.region} ${violation.element.key} ${violation.property} ${violation.value}, expected ${violation.expected} [${violation.id}]`;
      const old = wasIds.get(violation.id);

      if (old !== undefined)
        return old.value === violation.value && old.expected === violation.expected
          ? { label: "kept", state, line, changed: false }
          : {
              label: "kept",
              state,
              line: `${line} (was ${old.value}, expected ${old.expected})`,
              changed: true,
            };

      const hidden = masked.get(violation.id);

      return {
        label: hidden?.value === violation.value ? "revealed" : "added",
        state,
        line,
        changed: false,
      };
    });

    const removed = (was?.violations ?? [])
      .filter((violation) => !nowIds.has(violation.id))
      .map((violation): Paired => ({
        label: "removed",
        changed: false,
        state,
        line: `${violation.rule} ${violation.region} ${violation.element.key} ${violation.property} ${violation.value} [${violation.id}]`,
      }));

    return [...removed, ...current];
  });
}

function render(
  paired: readonly Paired[],
  before: Static<typeof Report>,
  after: Static<typeof Report>,
): string {
  const states = [...new Set(paired.map((entry) => entry.state))];
  const width = Math.max(5, ...states.map((state) => state.length));

  const count = (label: Label, state?: string): number =>
    paired.filter(
      (entry) => entry.label === label && (state === undefined || entry.state === state),
    ).length;

  const row = (name: string, state?: string): string =>
    `${name.padEnd(width)}  ${LABELS.map((label) => String(count(label, state)).padStart(label.length)).join("  ")}`;

  const listed = (label: Label): string[] =>
    paired.some((entry) => entry.label === label)
      ? [
          "",
          `${label} (${String(count(label))})`,
          ...paired.flatMap((entry) =>
            entry.label === label ? [`  ${entry.state} ${entry.line}`] : [],
          ),
        ]
      : [];

  const moved = (): string[] => {
    const changed = paired.filter((entry) => entry.label === "kept" && entry.changed);

    return changed.length === 0
      ? []
      : [
          "",
          `kept, moved (${String(changed.length)})`,
          ...changed.map((entry) => `  ${entry.state} ${entry.line}`),
        ];
  };

  return [
    `score: ${String(before.score)} -> ${String(after.score)}`,
    "",
    `${"".padEnd(width)}  ${LABELS.join("  ")}`,
    ...states.map((state) => row(state, state)),
    row("total"),
    ...listed("added"),
    ...listed("revealed"),
    ...moved(),
    ...listed("removed"),
    "",
    count("added") === 0 ? "added: none" : `added: ${String(count("added"))}`,
  ].join("\n");
}

const [beforeDirectory, afterDirectory] = process.argv.slice(2);

if (beforeDirectory === undefined || afterDirectory === undefined) {
  process.stderr.write(
    "Usage: pnpm --dir packages/desktop grid:diff <before report dir> <after report dir>\n",
  );
  process.exit(2);
}

const from = process.env.INIT_CWD ?? process.cwd();

const before = readReport(resolve(from, beforeDirectory));

const after = readReport(resolve(from, afterDirectory));

const paired = pair(before, after);

process.stdout.write(`${render(paired, before, after)}\n`);

process.exitCode = paired.some((entry) => entry.label === "added") ? 1 : 0;
