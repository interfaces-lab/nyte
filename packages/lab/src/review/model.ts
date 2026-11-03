import {
  EMPTY_PATH,
  FIRST,
  FIRST_GUIDE,
  SECOND,
  SECOND_GUIDE,
  counts,
  version,
  type Head as HeadRecord,
} from "./data";
import { units, type Cut, type Unit } from "./units";

export type Story = "read" | "findings" | "before" | "moved";

export type Reading = "one" | "all";

export type Placement = "tab" | "rail" | "item";

export type FindingsAt = "tab" | "inline" | "off";

export interface Take {
  readonly story: Story;
  readonly cut: Cut;
  readonly reading: Reading;
  readonly placement: Placement;
  readonly findings: FindingsAt;
}

export type Head = "first" | "second";

export interface S {
  readonly screen: "item" | "review";
  readonly view: "guide" | "findings";
  readonly phase: "sorted" | "writing" | "ready";
  readonly step: number;
  readonly arrived: number;
  readonly head: Head;
  readonly guideHead: Head;
  readonly rewriting: boolean;
  readonly current: number;
  readonly viewed: Readonly<Record<string, Head>>;
  readonly asking: boolean;
  readonly typed: string;
  readonly asked: boolean;
  readonly dropped: readonly string[];
  readonly sending: "idle" | "sending" | "sent";
}

const QUESTIONS = [
  "Should a filter that hides everything count as empty, or show a note?",
  "Is “Your work is committed” true when only ignored files changed?",
] as const;

export function askAt(take: Take): number {
  return take.reading === "one" ? emptyIndex(take) : 0;
}

export function question(take: Take): string {
  return askAt(take) === 0 ? QUESTIONS[0] : QUESTIONS[1];
}

export const ASK_LABEL: Record<Cut, string> = {
  stops: "Ask About This Stop",
  groups: "Ask About This Group",
  sections: "Ask About This Section",
  order: "Ask About This File",
};

export const NOUN: Record<Cut, string> = {
  stops: "stops",
  groups: "groups",
  sections: "sections",
  order: "files",
};

export const HEADS: Record<Head, HeadRecord> = { first: FIRST, second: SECOND };

export const TOTALS = FIRST.files.reduce(
  (sum, file) => ({
    added: sum.added + counts(file).added,
    removed: sum.removed + counts(file).removed,
  }),
  { added: 0, removed: 0 },
);

export function guideUnits(take: Take, s: S): readonly Unit[] {
  return units(take.cut, s.guideHead === "second" ? SECOND_GUIDE : FIRST_GUIDE);
}

export function emptyIndex(take: Take): number {
  return units(take.cut, FIRST_GUIDE).findIndex((unit) =>
    unit.files.some((file) => file.path === EMPTY_PATH),
  );
}

export function fileState(s: S, path: string): "unviewed" | "viewed" | "changed" {
  const mark = s.viewed[path];

  if (mark === undefined) return "unviewed";

  return mark === version(path, s.head) ? "viewed" : "changed";
}

export function finished(s: S, unit: Unit): boolean {
  return unit.files.every((file) => fileState(s, file.path) === "viewed");
}
