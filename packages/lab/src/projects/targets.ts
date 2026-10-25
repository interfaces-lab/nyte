import type { BaselineId } from "./evidence.ts";

export interface Target {
  readonly value: string;
  readonly why: string;
}

export const TARGETS: Readonly<Record<BaselineId, Target>> = {
  "hand-skills": {
    value: "0 in lane chats",
    why: "the lane attaches each role's skills on every turn",
  },
  "restated-rules": {
    value: "0 in lane briefs",
    why: "a worker's brief is the task and its checkout; rules come from the lane",
  },
  "subagent-share": {
    value: "≥ 60% of lane spend on Sol roles",
    why: "workers and babysitters run on Sol; Opus only reviews",
  },
  "child-steering": {
    value: "≥ 5 messages typed into lane sessions",
    why: "every row opens its session with a composer",
  },
  "opus-ci-polling": {
    value: "$0",
    why: "watches poll without a model; a wake starts a small Sol run",
  },
  "opus-sleep-turns": { value: "$0 in lane chats", why: "nothing in a lane waits by sleeping" },
  "pr-to-merge": {
    value: "ready ≤ 1 h after opening",
    why: "inherited failures route to one base fix on the first tick",
  },
  "red-prs": {
    value: "0 red for an inherited failure after one tick",
    why: "the keeper fixes the base once",
  },
  "ci-never-green": {
    value: "≥ 1 green CI run on main",
    why: "the format fix unblocks the steps that never ran",
  },
  "unattributed-calls": {
    value: "0 in lane checkouts",
    why: "one writer per checkout makes every change attributable",
  },
  "shared-checkout-writers": { value: "≤ 1", why: "lane chats never write the shared checkout" },
  "worktree-disk": {
    value: "≤ 10 GB",
    why: "release removes merged or fully snapshotted worktrees",
  },
  "copied-files": {
    value: "0 in lane worktrees",
    why: "lane worktrees start from origin/main with nothing copied in",
  },
  "hand-recovery": {
    value: "$0",
    why: "restore from the run's kept snapshot instead of redoing work",
  },
};
