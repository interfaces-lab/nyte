import type { Item, Kind } from "./model.ts";

/** How the step an item is on reads: an agent on it, you, a failure, someone else, or a queue. */
export type Tone =
  | "running"
  | "you"
  | "failed"
  | "others"
  | "queued"
  | "merged"
  | "done"
  | "stopped";

export interface Progress {
  readonly steps: readonly string[];
  /** The step it's on; `steps.length` once it's finished. */
  readonly at: number;
  readonly label: string;
  /** What the agents are doing, said inside a sentence: "writing", "reviewing". */
  readonly doing: string;
  readonly tone: Tone;
}

const STEPS: Readonly<Record<Kind, readonly string[]>> = {
  fix: ["Plan", "Write", "Check", "Review", "CI", "Merge"],
  babysit: ["Watch", "Fix", "CI", "Review", "Merge"],
  review: ["Run", "Compare", "Findings", "Send"],
};

const LABELS: Readonly<Record<Kind, readonly string[]>> = {
  fix: ["Planning", "Writing", "Checking", "Agent review", "CI", "Merge"],
  babysit: ["Watching", "Fixing", "CI", "Review", "Merge"],
  review: ["Running", "Comparing", "Findings", "Sending"],
};

/** Read off what the item says it's doing now; the first match wins. */
const RULES: Readonly<Record<Kind, readonly (readonly [RegExp, number])[]>> = {
  fix: [
    [/merge|your eyes/i, 5],
    [/triag|reply|cause|more from you|took it|queued|starting/i, 0],
    [/reading|writ|revis/i, 1],
    [/check/i, 2],
    [/review/i, 3],
    [/\bci\b|rebase|behind/i, 4],
  ],
  babysit: [
    [/fail|fix|push|screenshot/i, 1],
    [/\bci\b/i, 2],
    [/review|waiting on/i, 3],
    [/merge/i, 4],
  ],
  review: [
    [/run|start/i, 0],
    [/compar/i, 1],
    [/finding/i, 2],
  ],
};

/** The verb for a step whose label isn't one already. */
function doing(label: string): string {
  if (label === "Agent review") return "reviewing";

  return label === "Findings" ? "writing up" : label.toLowerCase();
}

export function finished(item: Item): boolean {
  return item.status === "merged" || item.status === "done";
}

export function progress(item: Item): Progress {
  const steps = STEPS[item.kind];
  const done = { steps, at: steps.length, doing: "" };

  if (item.status === "merged") return { ...done, label: "Merged", tone: "merged" };

  if (item.status === "done")
    return { ...done, label: item.now, tone: item.now === "Stopped" ? "stopped" : "done" };

  if (item.after !== null) return { steps, at: 0, label: "Up next", doing: "", tone: "queued" };
  const at = RULES[item.kind].find((rule) => rule[0].test(item.now))?.[1] ?? fallback(item);
  const label = /triag/i.test(item.now) ? "Triaging" : (LABELS[item.kind][at] ?? item.now);

  if (item.status === "needs-you")
    return {
      steps,
      at,
      label: item.now.length <= 22 ? item.now : "Your call",
      doing: "",
      tone: "you",
    };

  if (item.checks.some((check) => check.outcome === "failed"))
    return { steps, at, label: "CI failed", doing: "fixing", tone: "failed" };

  return {
    steps,
    at,
    label,
    doing: doing(label),
    tone: item.status === "watching" ? "others" : "running",
  };
}

function fallback(item: Item): number {
  const steps = STEPS[item.kind];

  if (item.status === "needs-you") return steps.length - 1;

  if (item.status === "watching") return item.kind === "fix" ? 4 : 2;

  return item.files.length > 0 ? 2 : 0;
}

export const LANES = [
  { id: "you", label: "Needs you" },
  { id: "progress", label: "In progress" },
  { id: "watching", label: "Watching CI" },
  { id: "next", label: "Up next" },
  { id: "finished", label: "Recently finished" },
] as const;

export type Lane = (typeof LANES)[number]["id"];

export function lane(item: Item): Lane {
  if (finished(item)) return "finished";

  if (item.after !== null) return "next";

  if (item.status === "needs-you") return "you";

  return item.status === "watching" ? "watching" : "progress";
}

/**
 * Lane order, then within a lane: what you can clear in one click first and the longest waiting
 * next; everything else newest first.
 */
export function arrange(items: readonly Item[]): readonly Item[] {
  const order = LANES.map((entry) => entry.id);

  return items.toSorted((left, right) => {
    const lanes = order.indexOf(lane(left)) - order.indexOf(lane(right));

    if (lanes !== 0) return lanes;

    if (lane(left) !== "you") return right.updated - left.updated;
    const quick = Number(quickWin(right)) - Number(quickWin(left));

    return quick === 0 ? left.updated - right.updated : quick;
  });
}

/** Waiting on you, and the answer it expects merges it. */
export function quickWin(item: Item): boolean {
  return item.ask?.answers.some((answer) => answer.primary && answer.status === "merged") ?? false;
}
