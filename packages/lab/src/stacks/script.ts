import { GREEN, MODELS, PENDING, checks } from "./model.ts";
import type { Ask, Finding, Item, PullRequest, Session, Stack, Step } from "./model.ts";

/** One tick is a simulated minute. */
export const TICK_MS = 4000;

/** Lands the next step once it is due. */
export function advance(item: Item, clock: number): Item {
  const step = item.script[0];

  if (step === undefined || clock < item.due) return item;
  const rest = item.script.slice(1);

  return { ...land(item, step, clock), script: rest, due: clock + (rest[0]?.wait ?? 0) };
}

export function land(item: Item, step: Step, clock: number): Item {
  return {
    ...item,
    status: step.status ?? item.status,
    now: step.now ?? item.now,
    summary: step.summary ?? item.summary,
    number: step.number ?? item.number,
    checks: step.checks ?? item.checks,
    ask: step.ask === undefined ? item.ask : step.ask,
    shot: step.shot ?? item.shot,
    files: step.files ?? item.files,
    sessions: step.sessions ?? item.sessions,
    findings: step.findings ?? item.findings,
    updated: clock,
    activity:
      step.event === undefined
        ? item.activity
        : [
            ...item.activity,
            { ...step.event, id: `${item.id}-${String(item.activity.length)}`, at: clock },
          ],
  };
}

export function schedule(item: Item, steps: readonly Step[], clock: number): Item {
  return { ...item, script: steps, due: clock + (steps[0]?.wait ?? 0) };
}

function crewNames(stack: Stack) {
  return {
    writes: MODELS[stack.crew.writes].short,
    reviews: MODELS[stack.crew.reviews].short,
    watches: MODELS[stack.crew.watches].short,
  };
}

function session(stack: Stack, duty: Session["duty"], state: string, turns: number): Session {
  return { duty, model: stack.crew[duty], state, turns, cost: turns * 0.03 };
}

/** Write, review, open, watch CI, screenshot, then ask whether it looks right. */
export function fixSteps(stack: Stack, number: number, rounds = 2): readonly Step[] {
  const crew = crewNames(stack);

  return [
    {
      wait: 1,
      now: `${crew.writes} is reading`,
      sessions: [session(stack, "writes", "Reading", 2)],
      event: {
        who: crew.writes,
        what: "started",
        text: "Reading the component and the tokens it uses.",
      },
    },
    {
      wait: 2,
      now: `${crew.writes} is writing`,
      sessions: [session(stack, "writes", "Writing", 5)],
      event: {
        who: crew.writes,
        what: "found the cause",
        text: "A hard-coded value where a token belongs.",
      },
    },
    {
      wait: 2,
      now: `${crew.reviews} is reviewing`,
      files: [
        { path: "packages/app/src/chrome/sidebar.stylex.ts", added: 3, removed: 2 },
        { path: "packages/ui/src/styles/schema.stylex.ts", added: 1, removed: 0 },
      ],
      sessions: [session(stack, "writes", "Done", 8), session(stack, "reviews", "Reviewing", 1)],
      event: {
        who: crew.writes,
        what: "wrote the fix",
        text: "2 files, 6 lines. Ran the tests next to them.",
        attachment: {
          diff: {
            file: "sidebar.stylex.ts",
            lines: [
              { sign: " ", text: "label: {" },
              { sign: "-", text: "  gap: 6," },
              { sign: "+", text: "  gap: space.s1_5," },
              { sign: " ", text: "}," },
            ],
          },
        },
      },
    },
    {
      wait: 2,
      number,
      status: "watching",
      now: "CI running",
      checks: PENDING,
      sessions: [
        session(stack, "writes", "Done", 8),
        session(stack, "reviews", "Approved", 2),
        session(stack, "watches", "Watching", 1),
      ],
      event: {
        who: crew.reviews,
        what: `approved and opened #${String(number)}`,
        text: "Reads the right tokens, and nothing else depends on the old value.",
      },
    },
    { wait: 1, now: "CI 3 of 6", checks: checks(3) },
    {
      wait: 2,
      now: "CI passed",
      checks: GREEN,
      event: {
        who: crew.watches,
        what: "CI passed",
        text: "All six checks passed on the first run.",
        attachment: { checks: GREEN },
      },
    },
    {
      wait: 1,
      status: "needs-you",
      now: "Ready for your eyes",
      shot: "generic",
      ask: lookAsk(stack, number, rounds),
      event: {
        who: stack.name,
        what: "took screenshots",
        text: "Light and dark, before and after.",
        attachment: { shot: "generic" },
      },
    },
  ];
}

export function lookAsk(stack: Stack, number: number, rounds: number): Ask {
  const crew = crewNames(stack);

  return {
    question: "Does it look right?",
    answers: [
      {
        label: "Looks Right, Merge",
        primary: true,
        status: "merged",
        now: "Merged",
        event: {
          who: "You",
          what: "merged",
          text: `Merged #${String(number)} into main.`,
          mine: true,
        },
      },
      {
        label: "Not Quite",
        primary: false,
        status: "working",
        now: `${crew.writes} is revising`,
        event: {
          who: "You",
          what: "sent it back",
          text: `Tell ${crew.writes} what's off in the reply below.`,
          mine: true,
        },
        after: revisionSteps(stack, number, rounds),
      },
    ],
  };
}

/** Revise, re-review, rerun CI, then ask again; `rounds` bounds how often it can come back. */
export function revisionSteps(stack: Stack, number: number, rounds: number): readonly Step[] {
  const crew = crewNames(stack);

  if (rounds === 0) return [];

  return [
    {
      wait: 3,
      now: `${crew.reviews} is reviewing`,
      event: {
        who: crew.writes,
        what: "revised it",
        text: "Pushed a second commit with your note.",
      },
    },
    {
      wait: 2,
      status: "watching",
      now: "CI running",
      checks: PENDING,
      event: { who: crew.reviews, what: "approved", text: "The revision holds up." },
    },
    { wait: 3, now: "CI passed", checks: GREEN },
    {
      wait: 1,
      status: "needs-you",
      now: "Ready for your eyes",
      shot: "generic",
      ask: lookAsk(stack, number, rounds - 1),
      event: {
        who: stack.name,
        what: "took new screenshots",
        text: "After the revision.",
        attachment: { shot: "generic" },
      },
    },
  ];
}

export function mergeAsk(number: number): Ask {
  return {
    question: `#${String(number)} is green. Merge it?`,
    answers: [
      {
        label: "Merge",
        primary: true,
        status: "merged",
        now: "Merged",
        event: {
          who: "You",
          what: "merged",
          text: `Merged #${String(number)} into main.`,
          mine: true,
        },
      },
      {
        label: "Not Yet",
        primary: false,
        status: "watching",
        now: "Green, waiting on you",
        event: { who: "You", what: "held it", text: "Left it open for now.", mine: true },
      },
    ],
  };
}

/** Watch CI; fix what's mechanical on your own branch, ask first on a teammate's. */
export function babysitSteps(stack: Stack, pull: PullRequest, mine: boolean): readonly Step[] {
  const watches = crewNames(stack).watches;
  const first = pull.author.name.split(" ")[0] ?? pull.author.name;

  const lead: readonly Step[] = [
    {
      wait: 1,
      now: "CI 1 of 6",
      checks: checks(1),
      sessions: [session(stack, "watches", "Watching", 1)],
    },
    {
      wait: 2,
      now: "lint failed",
      checks: checks(1, ["lint"]),
      event: {
        who: watches,
        what: "found a failure",
        text: "lint failed on an unused import this pull request added.",
        attachment: { checks: [{ name: "lint", outcome: "failed" }] },
      },
    },
  ];

  if (mine)
    return [
      ...lead,
      {
        wait: 1,
        now: "CI running",
        checks: PENDING,
        event: {
          who: watches,
          what: "pushed a fix",
          text: "Removed the unused import. CI is running again.",
        },
      },
      { wait: 2, now: "CI 4 of 6", checks: checks(4) },
      {
        wait: 2,
        now: "CI passed",
        checks: GREEN,
        event: { who: watches, what: "CI passed", text: "Green.", attachment: { checks: GREEN } },
      },
      { wait: 1, status: "needs-you", now: "Ready to merge", ask: mergeAsk(pull.number) },
    ];

  return [
    ...lead,
    {
      wait: 1,
      status: "needs-you",
      now: `Push the fix to ${first}'s branch?`,
      ask: {
        question: `lint failed on an unused import. Push the one-line fix to ${first}'s branch?`,
        answers: [
          {
            label: "Push It",
            primary: true,
            status: "watching",
            now: "CI running",
            checks: PENDING,
            event: {
              who: watches,
              what: "pushed",
              text: `Removed the unused import on ${first}'s branch. CI is running again.`,
            },
            after: [
              { wait: 2, now: "CI 4 of 6", checks: checks(4) },
              {
                wait: 2,
                now: "Waiting on review",
                checks: GREEN,
                event: {
                  who: watches,
                  what: "CI passed",
                  text: `Green. Waiting on ${first}'s reviewer.`,
                  attachment: { checks: GREEN },
                },
              },
            ],
          },
          {
            label: `Comment for ${first}`,
            primary: false,
            status: "watching",
            now: `Waiting on ${first}`,
            event: {
              who: watches,
              what: "commented",
              text: `Told ${first} which import to remove.`,
            },
            after: [
              {
                wait: 4,
                now: "CI running",
                checks: PENDING,
                event: { who: watches, what: "saw a push", text: `${first} pushed the fix.` },
              },
              {
                wait: 3,
                now: "Waiting on review",
                checks: GREEN,
                event: {
                  who: watches,
                  what: "CI passed",
                  text: "Green.",
                  attachment: { checks: GREEN },
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

const EMPTY_STATE_FINDINGS: readonly Finding[] = [
  {
    id: "size",
    title: "The message is 11px",
    detail: "Everything else in the panel is 13px. text.base matches it.",
    severity: "fix",
    kept: true,
  },
  {
    id: "center",
    title: "The icon sits 2px high",
    detail: "It's centered on its box, not its glyph. Center the glyph.",
    severity: "fix",
    kept: true,
  },
  {
    id: "dark",
    title: "The icon is faint in dark",
    detail: "contentDisabled is below 3:1 there. contentTertiary reads.",
    severity: "nit",
    kept: false,
  },
];

const GENERIC_FINDINGS: readonly Finding[] = [
  {
    id: "scale",
    title: "One gap is off the 4px scale",
    detail: "A 6px gap between the label and its icon. space.s1_5 is the token.",
    severity: "fix",
    kept: true,
  },
  {
    id: "hover",
    title: "Hover snaps instead of easing",
    detail: "The row has no transition; the rest of the list uses motion.durationFast.",
    severity: "fix",
    kept: true,
  },
  {
    id: "case",
    title: "A button label isn't Title Case",
    detail: "“Open in browser” should read “Open in Browser”.",
    severity: "nit",
    kept: false,
  },
];

/** Run the branch, screenshot it against main, then hand you findings to send or keep. */
export function reviewSteps(stack: Stack, pull: PullRequest): readonly Step[] {
  const reviews = crewNames(stack).reviews;
  const first = pull.author.name.split(" ")[0] ?? pull.author.name;
  const shot = pull.number === 489 ? "empty-state" : "generic";
  const findings = pull.number === 489 ? EMPTY_STATE_FINDINGS : GENERIC_FINDINGS;

  return [
    {
      wait: 1,
      now: `${reviews} is running it`,
      sessions: [session(stack, "reviews", "Running the branch", 2)],
      event: {
        who: reviews,
        what: "checked it out",
        text: `Running ${pull.branch === "" ? "the branch" : pull.branch} in its own worktree.`,
      },
    },
    {
      wait: 2,
      now: "Comparing with main",
      shot,
      event: {
        who: reviews,
        what: "took screenshots",
        text: "Main and this branch, light and dark.",
        attachment: { shot },
      },
    },
    {
      wait: 2,
      status: "needs-you",
      now: `${String(findings.length)} findings for ${first}`,
      findings,
      sessions: [session(stack, "reviews", "Done", 6)],
      ask: {
        question: `Send the findings you keep to ${first} as review comments?`,
        answers: [
          {
            label: "Send Comments",
            primary: true,
            status: "done",
            now: "Comments sent",
            event: {
              who: "You",
              what: "sent comments",
              text: `Sent to ${first} on GitHub.`,
              mine: true,
            },
          },
          {
            label: "Keep to Myself",
            primary: false,
            status: "done",
            now: "Reviewed",
            event: { who: "You", what: "kept the review", text: "Nothing sent.", mine: true },
          },
        ],
      },
      event: {
        who: reviews,
        what: `found ${String(findings.length)} things`,
        text: "Two worth fixing and a nit.",
      },
    },
  ];
}
