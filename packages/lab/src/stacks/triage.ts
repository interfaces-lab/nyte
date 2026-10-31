import { SURFACES } from "./model.ts";
import type { Agent, Ask, Related, Stack, Step, Surface } from "./model.ts";
import { TOKEN_CHANGE, fixSteps } from "./script.ts";
import type { Change } from "./script.ts";
import { leadAgent } from "./staffing.ts";

/** One exchange while the lead can't yet say what's wrong: what it says, and a reply it expects. */
export interface Round {
  readonly says: string;
  readonly questions?: readonly string[];
  readonly ask: string;
  readonly expected: { readonly label: string; readonly text: string };
}

/** How a vague bug report resolves in the lab: where it lives, what it asks, what it finds. */
export interface Report {
  readonly surface: Surface;
  readonly related: readonly Related[];
  readonly rounds: readonly Round[];
  readonly found: string;
  readonly change: Change;
}

/** Words that say something broke and describe what you saw, not what to change. */
export const REPORTED = /\b(anymore|broken|broke|stopped|no longer|used to|regress\w*)\b|\?\s*$/i;

/**
 * The lead files it, then asks until it can name the cause; it writes nothing on a guess. Each
 * answer, picked or typed, lands the next round. Once it knows, you say whether it starts.
 */
export function triageSteps(
  stack: Stack,
  number: number,
  staff: readonly Agent[],
  report: Report,
): readonly Step[] {
  const lead = leadAgent(stack);

  const filed: Step = {
    wait: 1,
    now: `${lead.name} is triaging`,
    surface: report.surface,
    event: {
      who: lead.name,
      what: "triaged it",
      text:
        report.related.length === 0
          ? `Filed under ${report.surface.name}. Nothing earlier looks like it.`
          : `Filed under ${report.surface.name}. It has come up before.`,
      attachment: report.related.length === 0 ? undefined : { related: report.related },
    },
  };

  return [filed, ...roundSteps(stack, number, staff, report, 0)];
}

function roundSteps(
  stack: Stack,
  number: number,
  staff: readonly Agent[],
  report: Report,
  index: number,
): readonly Step[] {
  const lead = leadAgent(stack);
  const round = report.rounds[index];

  if (round === undefined)
    return [
      {
        wait: 2,
        status: "needs-you",
        now: "Knows the cause",
        summary: report.found,
        ask: startAsk(stack, number, staff, report.change),
        event: { who: lead.name, what: "found it", text: report.found },
      },
    ];

  const next = roundSteps(stack, number, staff, report, index + 1);

  const ask: Ask = {
    question: round.ask,
    answers: [
      {
        label: round.expected.label,
        primary: true,
        status: "working",
        now: `${lead.name} is reading your reply`,
        event: { who: "You", what: "replied", text: round.expected.text, mine: true },
        after: next,
      },
    ],
    reply: next,
  };

  return [
    {
      wait: 2,
      status: "needs-you",
      now: "Needs more from you",
      ask,
      event: {
        who: lead.name,
        what: index === 0 ? "asked before starting" : "narrowed it",
        text: round.says,
        attachment: round.questions === undefined ? undefined : { questions: round.questions },
      },
    },
  ];
}

function startAsk(stack: Stack, number: number, staff: readonly Agent[], change: Change): Ask {
  const writer = staff[0] ?? leadAgent(stack);
  const work = fixSteps(stack, number, staff, 2, change);

  return {
    question: `Start the fix? ${writer.name} writes it and ${stack.name} opens a draft.`,
    answers: [
      {
        label: "Start the Fix",
        primary: true,
        status: "working",
        now: `${writer.name} is reading`,
        event: { who: "You", what: "started it", text: "Go ahead.", mine: true },
        after: work,
      },
      {
        label: "I'll Take It",
        primary: false,
        status: "done",
        now: "You took it",
        event: {
          who: "You",
          what: "took it",
          text: "I'll fix this one myself. Keep the notes.",
          mine: true,
        },
      },
    ],
    reply: work,
  };
}

/** The lab's worked example, after Linear's: the tab strip stops dragging the window. */
export const TAB_DRAG: Report = {
  surface: SURFACES.tabs,
  related: [
    {
      number: 467,
      title: "Can't drag the window from the tab strip",
      relation: "duplicate",
      state: "closed",
    },
    {
      number: 431,
      title: "Title bar won't drag while a dialog is open",
      relation: "related",
      state: "merged",
    },
  ],
  rounds: [
    {
      says: "I'm not writing a fix yet. The report doesn't say what takes the drag, and main drags fine for me.",
      questions: [
        "Which version are you on? Settings → About shows it.",
        "Does the empty space after the last tab drag in a short conversation you haven't scrolled?",
        "Does it fail in every view, or only the one you were in?",
      ],
      ask: "Which version, and does it happen everywhere?",
      expected: {
        label: "Latest, Only Some Views",
        text: "0.9.0-beta.3, the latest. Only in some conversations, I think.",
      },
    },
    {
      says: "0.9.0-beta.3 is current, so nothing has fixed it yet. Only some conversations points at something in the view covering the drag region, not the tab strip losing it. Does it depend on how far you've scrolled?",
      ask: "Does scrolling change it?",
      expected: {
        label: "Works at the Top",
        text: "It's the scroll. Once the conversation scrolls, dragging breaks. Scrolled all the way up, it works.",
      },
    },
  ],
  found:
    "The transcript's scroller is marked no-drag so you can select text. Once it scrolls, Chromium keeps that region pinned to the top of the window, under the tab strip. Moving it to the scrolled content fixes the strip and keeps selection.",
  change: {
    cause:
      "The no-drag region sits on the scroller, not on what scrolls, so it never moves out from under the tab strip.",
    files: [
      { path: "packages/app/src/conversation/activity.stylex.ts", added: 2, removed: 1 },
      { path: "packages/app/src/conversation/activity.tsx", added: 1, removed: 1 },
    ],
    diff: {
      file: "activity.stylex.ts",
      lines: [
        { sign: " ", text: "scroller: {" },
        { sign: " ", text: '  overflowY: "auto",' },
        { sign: "-", text: '  WebkitAppRegion: "no-drag",' },
        { sign: " ", text: "}," },
        { sign: "+", text: 'content: { WebkitAppRegion: "no-drag" },' },
      ],
    },
    guide: {
      summary:
        "Moves the no-drag region from the transcript's scroller to its content, so it scrolls away with the messages instead of staying under the tab strip. Text selection still can't start a window drag.",
      files: [
        {
          path: "packages/app/src/conversation/activity.stylex.ts",
          added: 2,
          removed: 1,
          note: "The fix: where the region lives now.",
        },
        {
          path: "packages/app/src/conversation/activity.tsx",
          added: 1,
          removed: 1,
          note: "Puts the new style on the content box. Nothing else changes.",
        },
      ],
      unchecked:
        "Window dragging is native, so CI can't feel it. Try it once scrolled and once at the top.",
    },
  },
};

/** Any other report sent from the composer: one round of questions, then the usual fix. */
export const VAGUE: Report = {
  surface: SURFACES.unknown,
  related: [],
  rounds: [
    {
      says: "I'm not writing a fix yet. I can't reproduce this from the report alone.",
      questions: [
        "Which view were you in when it happened?",
        "Does it still happen after a reload?",
        "Do you remember a build where it worked?",
      ],
      ask: "Where does it happen?",
      expected: {
        label: "Only in One View",
        text: "Only in one view, and a reload doesn't help. Everything else is fine.",
      },
    },
  ],
  found:
    "That narrows it to one view. The writer starts there and the checker compares it with a view that works.",
  change: TOKEN_CHANGE,
};
