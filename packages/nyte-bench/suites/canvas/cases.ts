import type { Suite } from "../../src/case.ts";
import {
  CI_TIMINGS_JSON,
  EXPENSES_CSV,
  LATENCY_JSON,
  README_WITH_TYPO,
  SIGNUPS_CSV,
} from "./data.ts";

const NO_CANVAS = [/^canvas_/u];

/** Looking around, reading the data, working a number out and rendering: the prompt doesn't name the file, so finding it is fair work. */
const ROUNDS_TO_FIND = 4;

/** Reading a named file, working with it and acting on it. */
const ROUNDS_NAMED = 3;

/** The tail of expenses.csv's total, 3,582.93, so the check passes however the thousands are written. */
const TOTAL_TAIL = "582.93";

/**
 * Whether the chat shows data as a canvas when that reads faster than prose, without being told
 * the tool exists, and whether the canvas it renders works. No prompt names the canvas, a chart,
 * a graph or a diagram, except the two `guard` cases that ask for one in plain words.
 */
export const CANVAS: Suite = {
  id: "canvas",
  title: "Canvas",
  cases: [
    {
      id: "trend-signups",
      kind: "bad",
      experience:
        "Asked how a year of monthly numbers went, the agent listed them in prose and never showed the trend.",
      prompt: "How did signups go this year? Anything I should worry about?",
      servers: {},
      files: { "signups.csv": SIGNUPS_CSV },
      expect: { rounds: ROUNDS_TO_FIND, calls: ["canvas_render"], canvas: true, answer: ["pro"] },
    },
    {
      id: "spending-breakdown",
      kind: "bad",
      experience:
        "Asked where the money goes, the agent wrote a bulleted list of totals the user had to compare by eye.",
      prompt: "Where's my money going this month?",
      servers: {},
      files: { "expenses.csv": EXPENSES_CSV },
      expect: { rounds: ROUNDS_TO_FIND, calls: ["canvas_render"], canvas: true, answer: ["rent"] },
    },
    {
      id: "latency-regression",
      kind: "bad",
      experience:
        "Asked whether a release got slower, the agent answered from a table of fifteen numbers without showing the jump.",
      prompt: "Did v3 make anything slower than v2?",
      servers: {},
      files: { "latency.json": LATENCY_JSON },
      expect: {
        rounds: ROUNDS_TO_FIND,
        calls: ["canvas_render"],
        canvas: true,
        answer: ["/search"],
      },
    },
    {
      id: "ci-time",
      kind: "bad",
      experience:
        "Asked what slows CI down, the agent named the slowest suites without showing how much of the run each one takes.",
      prompt: "What's eating our CI time?",
      servers: {},
      files: { "ci-timings.json": CI_TIMINGS_JSON },
      expect: {
        rounds: ROUNDS_TO_FIND,
        calls: ["canvas_render"],
        canvas: true,
        answer: ["checkout"],
      },
    },
    {
      id: "asked-chart",
      kind: "guard",
      experience: "A user who asks for a chart in plain words gets one that works.",
      prompt: "Chart the monthly signups in signups.csv.",
      servers: {},
      files: { "signups.csv": SIGNUPS_CSV },
      expect: { rounds: ROUNDS_NAMED, calls: ["canvas_render"], canvas: true },
    },
    {
      id: "asked-dashboard",
      kind: "guard",
      experience: "A user who asks for a dashboard gets one canvas that holds it.",
      prompt: "Put together a quick dashboard of latency.json for the team.",
      servers: {},
      files: { "latency.json": LATENCY_JSON },
      expect: { rounds: ROUNDS_NAMED, calls: ["canvas_render"], canvas: true },
    },
    {
      id: "single-number",
      kind: "control",
      experience: "A question with a one-number answer gets the number, not a canvas.",
      prompt: "What did I spend in total in expenses.csv?",
      servers: {},
      files: { "expenses.csv": EXPENSES_CSV },
      expect: { rounds: ROUNDS_NAMED, callsMustNot: NO_CANVAS, answer: [TOTAL_TAIL] },
    },
    {
      id: "fix-typo",
      kind: "control",
      experience: "A code chore is done with an edit and no canvas.",
      prompt: "Fix the typo in README.md.",
      servers: {},
      files: { "README.md": README_WITH_TYPO },
      expect: { rounds: ROUNDS_NAMED, calls: ["edit"], callsMustNot: NO_CANVAS },
    },
    {
      id: "concept-question",
      kind: "control",
      experience: "A short conceptual question gets a short answer and no canvas.",
      prompt: "In two sentences, what's the difference between a process and a thread?",
      servers: {},
      files: {},
      expect: { rounds: 1, callsMustNot: NO_CANVAS },
    },
  ],
};
