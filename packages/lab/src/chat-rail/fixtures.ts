/**
 * Scenarios for the chat rail: the collapsed workbench panel beside a chat.
 * Usage carries the API-equivalent cost the host already records per session
 * (`UsageTotals` in `packages/protocol/src/environment.ts`).
 */

export interface ChatUsage {
  readonly cost: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly turns: number;
}

export type ChatHead =
  | { readonly kind: "none"; readonly base: string }
  | {
      readonly kind: "branch";
      readonly name: string;
      readonly base: string;
      readonly ahead: number;
      readonly behind: number;
    }
  | { readonly kind: "detached"; readonly oid: string };

export interface ChatChanges {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export type TabKind = "changes" | "files" | "browser" | "terminal";

export interface ChatRailState {
  readonly title: string;
  readonly note: string;
  readonly usage: ChatUsage;
  readonly context: { readonly tokens: number; readonly window: number };
  readonly worktree: string;
  readonly worktrees: readonly string[];
  readonly head: ChatHead;
  readonly changes: ChatChanges;
  readonly environment: string;
  readonly tabs: readonly { readonly kind: TabKind; readonly label: string }[];
}

const WORKTREES = ["lemon-unicorn", "plum-otter", "nyte"] as const;

export const SCENARIOS: readonly ChatRailState[] = [
  {
    title: "Fresh chat",
    note: "Nothing spent, a sliver of context, the main checkout.",
    usage: { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 },
    context: { tokens: 4_210, window: 258_000 },
    worktree: "nyte",
    worktrees: WORKTREES,
    head: { kind: "branch", name: "main", base: "main", ahead: 0, behind: 0 },
    changes: { files: 0, added: 0, removed: 0 },
    environment: "This Mac",
    tabs: [],
  },
  {
    title: "Reference",
    note: "The sketch: a fresh worktree with no branch yet.",
    usage: {
      cost: 4.55,
      input: 412_000,
      output: 38_400,
      cacheRead: 2_140_000,
      cacheWrite: 96_000,
      turns: 14,
    },
    context: { tokens: 101_402, window: 258_000 },
    worktree: "lemon-unicorn",
    worktrees: WORKTREES,
    head: { kind: "none", base: "main" },
    changes: { files: 0, added: 0, removed: 0 },
    environment: "This Mac",
    tabs: [],
  },
  {
    title: "Mid-task",
    note: "On a branch, ahead of main, with edits and open tabs.",
    usage: {
      cost: 12.8,
      input: 1_180_000,
      output: 96_200,
      cacheRead: 6_420_000,
      cacheWrite: 240_000,
      turns: 41,
    },
    context: { tokens: 164_880, window: 258_000 },
    worktree: "lemon-unicorn",
    worktrees: WORKTREES,
    head: { kind: "branch", name: "feat/chat-rail", base: "main", ahead: 3, behind: 0 },
    changes: { files: 6, added: 128, removed: 14 },
    environment: "This Mac",
    tabs: [
      { kind: "changes", label: "Changes" },
      { kind: "terminal", label: "pnpm dev" },
    ],
  },
  {
    title: "Near the limit",
    note: "Context past 80% turns the meter amber. Cloud server, behind its base.",
    usage: {
      cost: 31.2,
      input: 2_940_000,
      output: 210_500,
      cacheRead: 14_800_000,
      cacheWrite: 520_000,
      turns: 96,
    },
    context: { tokens: 231_900, window: 258_000 },
    worktree: "plum-otter",
    worktrees: WORKTREES,
    head: { kind: "branch", name: "fix/usage-rollup", base: "main", ahead: 1, behind: 4 },
    changes: { files: 2, added: 9, removed: 31 },
    environment: "devbox",
    tabs: [{ kind: "browser", label: "localhost:5173" }],
  },
];
