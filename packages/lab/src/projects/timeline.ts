import type { IconName } from "@nyte-ai/ui/icon";
import type { Tint } from "@nyte-ai/ui/surface-theme";

type AgentPlace = "cloud" | "local";

type AgentState = "working" | "done" | "archived";

export interface Agent {
  readonly id: string;
  readonly task: string;
  readonly state: AgentState;
  readonly place: AgentPlace;
  readonly result?: string;
}

export interface ContextFile {
  readonly path: string;
  readonly note: string;
}

export interface Decision {
  readonly kind: "decision";
  readonly question: string;
  readonly detail: string;
  readonly action: string;
  readonly reply: string;
}

export type Entry =
  | { readonly kind: "you"; readonly text: string }
  | { readonly kind: "coordinator"; readonly text: string }
  | { readonly kind: "delegated"; readonly title: string; readonly agents: readonly string[] }
  | {
      readonly kind: "handled";
      readonly question: string;
      readonly answer: string;
      readonly source: string;
    }
  | { readonly kind: "archived"; readonly text: string }
  | { readonly kind: "signal"; readonly source: string; readonly text: string }
  | { readonly kind: "context"; readonly path: string; readonly text: string }
  | Decision;

interface Step {
  readonly label: string;
  readonly entries: readonly Entry[];
  readonly agents: readonly Agent[];
  readonly context: readonly ContextFile[];
}

function agent(
  id: string,
  task: string,
  state: AgentState,
  result?: string,
  place: AgentPlace = "cloud",
): Agent {
  return { id, task, state, place, result };
}

const MERGE: Decision = {
  kind: "decision",
  question: "Merge PR #414?",
  detail:
    "The About dialog now returns focus to the titlebar instead of the menu that opened it. The check on this Mac confirmed it.",
  action: "Merge PR #414",
  reply: "Merge it.",
};

export const STEPS: readonly Step[] = [
  {
    label: "Brief",
    entries: [
      {
        kind: "you",
        text: "Move every dialog in packages/app onto the new Dialog surface. One PR per batch, and keep confirm copy as it is.",
      },
      { kind: "context", path: "preferences.md", text: "Saved how you want the work done" },
      {
        kind: "coordinator",
        text: "I'll map the dialogs first so every agent starts from the same picture.",
      },
    ],
    agents: [],
    context: [{ path: "preferences.md", note: "One PR per batch. Confirm copy stays as written." }],
  },
  {
    label: "Research",
    entries: [{ kind: "delegated", title: "Research", agents: ["inventory", "tests"] }],
    agents: [
      agent("inventory", "Inventory dialogs in packages/app", "working"),
      agent("tests", "Find how dialog tests run", "working"),
    ],
    context: [],
  },
  {
    label: "Plan",
    entries: [
      { kind: "context", path: "dialogs.md", text: "14 dialogs, grouped into 4 batches" },
      { kind: "context", path: "testing.md", text: "How to run and read the dialog tests" },
      { kind: "archived", text: "Archived 2 research agents" },
      {
        kind: "coordinator",
        text: "14 dialogs in 4 batches. Settings goes first: those dialogs share no state with chats, so a mistake stays small.",
      },
    ],
    agents: [
      agent("inventory", "Inventory dialogs in packages/app", "archived", "dialogs.md"),
      agent("tests", "Find how dialog tests run", "archived", "testing.md"),
    ],
    context: [
      { path: "dialogs.md", note: "14 dialogs in 4 batches, with the owner of each." },
      { path: "testing.md", note: "pnpm --dir packages/app test, then the Electron suite." },
    ],
  },
  {
    label: "Batch 1",
    entries: [
      {
        kind: "delegated",
        title: "Batch 1 · Settings",
        agents: ["providers", "connections", "about", "archive-all"],
      },
    ],
    agents: [
      agent("providers", "Providers sign-in dialog", "working"),
      agent("connections", "Connections dialog", "working"),
      agent("about", "About dialog", "working"),
      agent("archive-all", "Archive All confirmation", "working"),
    ],
    context: [],
  },
  {
    label: "Handled",
    entries: [
      {
        kind: "handled",
        question: "Can I shorten the Archive All confirm label?",
        answer: "No. Confirm copy stays as written.",
        source: "preferences.md",
      },
      {
        kind: "handled",
        question: "Which command covers the dialog tests?",
        answer: "The two in testing.md, in that order.",
        source: "testing.md",
      },
    ],
    agents: [
      agent("providers", "Providers sign-in dialog", "done", "PR #412"),
      agent("connections", "Connections dialog", "done", "PR #413"),
    ],
    context: [],
  },
  {
    label: "Needs you",
    entries: [
      { kind: "delegated", title: "Check on this Mac", agents: ["focus"] },
      {
        kind: "coordinator",
        text: "Four PRs are open and CI is green. One changes behaviour, so it's your call.",
      },
      MERGE,
    ],
    agents: [
      agent("about", "About dialog", "done", "PR #414"),
      agent("archive-all", "Archive All confirmation", "done", "PR #415"),
      agent(
        "focus",
        "Check focus return in the desktop app",
        "done",
        "Focus lands on the titlebar",
        "local",
      ),
    ],
    context: [],
  },
  {
    label: "Merged",
    entries: [
      { kind: "you", text: MERGE.reply },
      { kind: "signal", source: "Follow my PRs", text: "#412, #413, #414, and #415 merged" },
      { kind: "archived", text: "Archived 5 finished agents" },
      {
        kind: "delegated",
        title: "Batch 2 · Conversation",
        agents: ["attach", "model-picker", "delete"],
      },
      {
        kind: "coordinator",
        text: "Batch 1 is in. Batch 2 has started; I'll only bring you PRs that change behaviour.",
      },
    ],
    agents: [
      agent("providers", "Providers sign-in dialog", "archived", "PR #412"),
      agent("connections", "Connections dialog", "archived", "PR #413"),
      agent("about", "About dialog", "archived", "PR #414"),
      agent("archive-all", "Archive All confirmation", "archived", "PR #415"),
      agent(
        "focus",
        "Check focus return in the desktop app",
        "archived",
        "Focus lands on the titlebar",
        "local",
      ),
      agent("attach", "Attachment picker dialog", "working"),
      agent("model-picker", "Model picker dialog", "working"),
      agent("delete", "Delete Chat confirmation", "working"),
    ],
    context: [
      {
        path: "preferences.md",
        note: "One PR per batch. Confirm copy stays. Only behaviour changes need review.",
      },
    ],
  },
  {
    label: "Gardening",
    entries: [
      {
        kind: "signal",
        source: "Follow my PRs",
        text: "#431 adds a raw <dialog> to the share sheet",
      },
      { kind: "delegated", title: "From #431", agents: ["share", "lint"] },
      { kind: "context", path: "lint.md", text: "Noted a repeated mistake" },
      {
        kind: "coordinator",
        text: "That's the second raw <dialog> this week, so one agent is moving it and another is drafting a lint rule against it.",
      },
    ],
    agents: [
      agent("share", "Move the share sheet onto Dialog", "working"),
      agent("lint", "Draft a no-raw-dialog lint rule", "working"),
      agent("model-picker", "Model picker dialog", "done", "PR #433"),
    ],
    context: [{ path: "lint.md", note: "Raw <dialog> seen twice: rule drafted in #434." }],
  },
];

export interface ProjectState {
  readonly entries: readonly Entry[];
  readonly agents: ReadonlyMap<string, Agent>;
  readonly context: readonly (ContextFile & { readonly fresh: boolean })[];
  readonly pending: Decision | undefined;
}

export function projectAt(step: number): ProjectState {
  const agents = new Map<string, Agent>();
  const context = new Map<string, ContextFile & { readonly fresh: boolean }>();
  const shown = STEPS.slice(0, step + 1);

  for (const [index, current] of shown.entries()) {
    for (const next of current.agents) agents.set(next.id, next);

    for (const file of current.context)
      context.set(file.path, { ...file, fresh: index === shown.length - 1 });
  }

  return {
    entries: shown.flatMap((current) => current.entries),
    agents,
    context: [...context.values()],
    pending: shown.at(-1)?.entries.find((entry): entry is Decision => entry.kind === "decision"),
  };
}

/** How a project is told apart at a glance: one glyph in one hue. */
export interface Appearance {
  readonly icon: IconName;
  readonly tint: Tint;
}

/** What the switcher and the rail know about a project without opening it. */
export interface ProjectListing {
  readonly id: string;
  readonly name: string;
  readonly appearance: Appearance;
  readonly working: number;
  readonly ask: string | undefined;
  readonly updated: string;
  /** The coordinator's latest line, shown when the project opens. */
  readonly brief: string;
}

export const PROJECT = "Dialog surface migration";

export const PROJECT_ID = "dialogs";

export const PROJECT_APPEARANCE: Appearance = { icon: "layers", tint: "blue" };

export const OTHER_PROJECTS: readonly ProjectListing[] = [
  {
    id: "release",
    name: "Release 0.1",
    appearance: { icon: "bolt", tint: "purple" },
    working: 1,
    ask: "Ship the release notes as drafted?",
    updated: "8m",
    brief:
      "The notes are drafted and the build is green. One call before tagging: ship the notes as written?",
  },
  {
    id: "garden",
    name: "Design system gardening",
    appearance: { icon: "sparkle", tint: "green" },
    working: 2,
    ask: undefined,
    updated: "12m",
    brief: "Two agents are renaming tokens that drifted from the schema. Nothing needs you.",
  },
  {
    id: "inbox",
    name: "Sidebar inbox",
    appearance: { icon: "inbox-empty", tint: "orange" },
    working: 0,
    ask: undefined,
    updated: "2d",
    brief: "Paused after PR #398 merged. Say what comes next and I'll pick it up.",
  },
];

export const LOOSE_CHATS = [
  "Explain archive undo in session-actions",
  "Why is cold start slow on Intel?",
  "Rename a git branch safely",
] as const;
