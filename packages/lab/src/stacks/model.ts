import type { IconName } from "@nyte-ai/ui/icon";
import type { Tint } from "@nyte-ai/ui/surface-theme";

export type ModelId = "sol" | "opus" | "sonnet" | "mini";

export interface Model {
  readonly id: ModelId;
  readonly name: string;
  readonly short: string;
  readonly icon: IconName;
  readonly note: string;
}

export const MODEL_IDS: readonly ModelId[] = ["sol", "opus", "sonnet", "mini"];

export const MODELS: Readonly<Record<ModelId, Model>> = {
  sol: {
    id: "sol",
    name: "GPT-6.1 Sol",
    short: "Sol",
    icon: "model-openai",
    note: "Fast, writes most fixes",
  },
  opus: {
    id: "opus",
    name: "Claude Opus 5.5",
    short: "Opus",
    icon: "model-anthropic",
    note: "Careful, costs the most",
  },
  sonnet: {
    id: "sonnet",
    name: "Claude Sonnet 5",
    short: "Sonnet",
    icon: "model-anthropic",
    note: "Balanced",
  },
  mini: {
    id: "mini",
    name: "GPT-6.1 Mini",
    short: "Mini",
    icon: "model-openai",
    note: "Cheap, good at waiting",
  },
};

/** Anyone the lead can hand work to. Nothing about it is fixed: you name it and say what it does. */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly model: ModelId;
  readonly does: string;
  readonly skills: readonly string[];
}

export const SKILLS: readonly string[] = [
  "better-ui",
  "nyte-styles",
  "verify-nyte",
  "clean-copy",
  "blast-radius",
  "principle-review",
  "tdd",
];

export const ASKS: readonly string[] = [
  "Before merging",
  "Before pushing to a teammate's branch",
  "Before spending over $2 on one item",
  "Before rebasing",
];

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly tone: "orange" | "blue" | "violet" | "green";
}

export const YOU: Person = { id: "you", name: "You", initials: "WG", tone: "orange" };

export const KAI: Person = { id: "kai", name: "Kai Tanaka", initials: "KT", tone: "blue" };

export const MAYA: Person = { id: "maya", name: "Maya Reyes", initials: "MR", tone: "violet" };

export interface Stack {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly icon: IconName;
  readonly tint: Tint;
  /** The stack's own agent, named after it: plans each task, reviews it and opens the pull request. */
  readonly lead: ModelId;
  readonly agents: readonly Agent[];
  readonly skills: readonly string[];
  readonly asks: readonly string[];
  readonly spent: number;
  readonly budget: number;
  readonly due: string | null;
}

export type Status = "needs-you" | "working" | "watching" | "merged" | "done";

export const GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly statuses: readonly Status[];
}[] = [
  { id: "needs-you", label: "Needs you", statuses: ["needs-you"] },
  { id: "working", label: "Working", statuses: ["working"] },
  { id: "watching", label: "Watching CI", statuses: ["watching"] },
  { id: "done", label: "Done today", statuses: ["merged", "done"] },
];

export type Kind = "fix" | "babysit" | "review";

export interface Check {
  readonly name: string;
  readonly outcome: "passed" | "failed" | "pending";
}

const CHECK_NAMES = ["format", "lint", "typecheck", "test · macOS", "test · Linux", "build"];

/** Six checks, the first `passed` of them passed, `failed` named ones failed, the rest pending. */
export function checks(passed: number, failed: readonly string[] = []): readonly Check[] {
  return CHECK_NAMES.map((name, index) => ({
    name,
    outcome: failed.includes(name) ? "failed" : index < passed ? "passed" : "pending",
  }));
}

export const GREEN = checks(6);

export const PENDING = checks(0);

export interface DiffLine {
  readonly sign: "+" | "-" | " ";
  readonly text: string;
}

export interface Attachment {
  readonly checks?: readonly Check[];
  readonly diff?: { readonly file: string; readonly lines: readonly DiffLine[] };
  readonly shot?: ShotId;
  readonly images?: readonly string[];
  /** Shows the item's findings, which you keep or drop before they're sent. */
  readonly findings?: boolean;
}

/** The tick it happened on; one tick is a minute, and the seed's history is before tick 0. */
export type Moment = number;

export interface Event {
  readonly id: string;
  readonly who: string;
  readonly what: string;
  readonly at: Moment;
  readonly text: string;
  readonly mine?: boolean;
  readonly attachment?: Attachment;
}

export interface Answer {
  readonly label: string;
  readonly primary: boolean;
  readonly status: Status;
  readonly now: string;
  readonly checks?: readonly Check[];
  readonly event: Omit<Event, "id" | "at">;
  readonly after?: readonly Step[];
}

export interface Ask {
  readonly question: string;
  readonly answers: readonly Answer[];
}

export type ShotId = "row-height" | "model-chip" | "empty-state" | "generic";

export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/** One agent's session on one item, kept as it was even if the agent changes later. */
export interface Session {
  readonly name: string;
  readonly model: ModelId;
  readonly does: string;
  readonly lead: boolean;
  readonly state: string;
  readonly turns: number;
  readonly cost: number;
}

export interface Finding {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly severity: "fix" | "nit";
  readonly kept: boolean;
}

export interface Surface {
  readonly name: string;
  readonly icon: IconName;
  readonly tint: Tint;
}

export const SURFACES = {
  sidebar: { name: "Desktop · Sidebar", icon: "panel-left", tint: "purple" },
  composer: { name: "Desktop · Composer", icon: "writing", tint: "blue" },
  terminal: { name: "Desktop · Terminal", icon: "console", tint: "teal" },
  tabs: { name: "Desktop · Tabs", icon: "window-app", tint: "orange" },
  settings: { name: "Desktop · Settings", icon: "settings", tint: "gray" },
  toasts: { name: "Desktop · Toasts", icon: "bell", tint: "yellow" },
  changes: { name: "Desktop · Changes", icon: "diff", tint: "green" },
  conversation: { name: "Desktop · Conversation", icon: "bubble-heart", tint: "pink" },
  store: { name: "Host · Store", icon: "server", tint: "brown" },
  docs: { name: "Docs", icon: "book", tint: "blue" },
  unknown: { name: "Not known yet", icon: "sparkle", tint: "gray" },
} as const satisfies Readonly<Record<string, Surface>>;

/** What changes when a step lands; anything left out stays as it was. */
export interface Step {
  readonly wait: number;
  readonly status?: Status;
  readonly now?: string;
  readonly summary?: string;
  readonly number?: number;
  readonly checks?: readonly Check[];
  readonly ask?: Ask | null;
  readonly shot?: ShotId;
  readonly files?: readonly FileChange[];
  readonly sessions?: readonly Session[];
  readonly findings?: readonly Finding[];
  readonly event?: Omit<Event, "id" | "at">;
}

export interface Item {
  readonly id: string;
  readonly stack: string;
  readonly number: number | null;
  readonly kind: Kind;
  readonly title: string;
  readonly summary: string;
  readonly status: Status;
  readonly now: string;
  readonly author: Person;
  readonly branch: string;
  readonly surface: Surface;
  readonly checks: readonly Check[];
  readonly ask: Ask | null;
  readonly shot: ShotId | null;
  readonly files: readonly FileChange[];
  readonly sessions: readonly Session[];
  readonly findings: readonly Finding[];
  readonly activity: readonly Event[];
  readonly updated: Moment;
  readonly script: readonly Step[];
  readonly due: number;
}

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly author: Person;
  readonly opened: string;
  readonly branch: string;
  readonly surface: Surface;
}

export interface Chat {
  readonly id: string;
  readonly title: string;
  readonly pulls: readonly number[];
  readonly working: boolean;
}
