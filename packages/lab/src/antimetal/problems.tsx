import { motion, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";

export const problems = [
  {
    id: "vcs",
    message: "Agent turns can't be undone.",
    detail: "Checkpoints, file diffs, undo, and branches.",
    cost: "+1,000 lines",
    location: "agent.ts 4:23",
  },
  {
    id: "workbench",
    message: "The agent has nowhere to work.",
    detail: "Editor tabs, terminals, file search, and diff review.",
    cost: "+9,000 lines",
    location: "my-cursor",
  },
  {
    id: "design",
    message: "Every state still needs a design.",
    detail: "The composer, tool calls, keyboard states, and the little details.",
    cost: "+10 hours",
    location: "my-cursor",
  },
  {
    id: "sessions",
    message: "Clients drift out of sync.",
    detail: "Streaming, reconnects, queued messages, and replay.",
    cost: "+2 days",
    location: "agent.ts 5:18",
  },
  {
    id: "providers",
    message: "Only one model is supported.",
    detail: "Different APIs, credentials, capabilities, and usage formats.",
    cost: "+1 week",
    location: "agent.ts 6:12",
  },
  {
    id: "approvals",
    message: "Tools run without approval.",
    detail: "Permission prompts, cancellation, retries, and recovery.",
    cost: "+1 day",
    location: "agent.ts 2:10",
  },
] as const;

export type ProblemId = (typeof problems)[number]["id"];

export const timeline = {
  problemsOpen: 0.1,
  firstProblem: 0.16,
  problemStep: 0.075,
  firstFix: 0.66,
  fixStep: 0.02,
} as const;

export function problemAppears(id: ProblemId) {
  return (
    timeline.firstProblem +
    problems.findIndex((problem) => problem.id === id) * timeline.problemStep
  );
}

export function problemFixed(id: ProblemId) {
  return timeline.firstFix + problems.findIndex((problem) => problem.id === id) * timeline.fixStep;
}

export function ProblemRow({
  problem,
  progress,
  reducedMotion,
}: {
  problem: (typeof problems)[number];
  progress: MotionValue<number>;
  reducedMotion: boolean;
}) {
  const appears = problemAppears(problem.id);
  const fixed = problemFixed(problem.id);

  const opacity = useTransform(
    progress,
    [0, appears, appears + 0.025, fixed, fixed + 0.03, 1],
    [0, 0, 1, 1, 0, 0],
  );

  const y = useTransform(progress, [0, appears, appears + 0.04, 1], [10, 10, 0, 0]);

  return (
    <motion.li className="problem" style={{ opacity, y: reducedMotion ? 0 : y }}>
      <ErrorIcon />
      <span className="problem-message">{problem.message}</span>
      <span className="problem-cost">{problem.cost}</span>
      <span className="problem-detail">{problem.detail}</span>
      <span className="problem-location">{problem.location}</span>
    </motion.li>
  );
}

export function Squiggle({
  id,
  progress,
  children,
}: {
  id: ProblemId;
  progress: MotionValue<number>;
  children: string;
}) {
  const appears = problemAppears(id);
  const fixed = problemFixed(id);

  const opacity = useTransform(
    progress,
    [0, appears, appears + 0.02, fixed, fixed + 0.02, 1],
    [0, 0, 1, 1, 0, 0],
  );

  return (
    <span className="squiggle-target">
      {children}
      <motion.span className="squiggle" style={{ opacity }} aria-hidden="true" />
    </span>
  );
}

export function ErrorIcon() {
  return (
    <svg className="error-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
