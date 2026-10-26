import { GREEN, PENDING, checks } from "./model.ts";
import type { Agent, Ask, Finding, Item, PullRequest, Session, Stack, Step } from "./model.ts";
import { WATCHER, leadAgent, sessionFor } from "./staffing.ts";

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

/** The sessions on a fix: the lead first, then each agent in the order it was staffed. */
function team(
  stack: Stack,
  staff: readonly Agent[],
  lead: string,
  states: readonly string[],
): readonly Session[] {
  return [
    sessionFor(leadAgent(stack), lead, 2, true),
    ...staff.map((agent, index) => sessionFor(agent, states[index] ?? "Waiting", 3 + index * 2)),
  ];
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The writer works, each other agent checks, the lead reviews and opens it, Nyte watches CI. */
export function fixSteps(
  stack: Stack,
  number: number,
  staff: readonly Agent[],
  rounds = 2,
): readonly Step[] {
  const lead = leadAgent(stack);
  const writer = staff[0] ?? lead;
  const checkers = staff.slice(1);
  const doneAll = staff.map(() => "Done");

  const checks_: readonly Step[] = checkers.map((checker, index) => {
    const next = checkers[index + 1];
    const visual = /screenshot|light|dark|pixel|visual/i.test(checker.does);

    return {
      wait: 2,
      now: next === undefined ? `${lead.name} is reviewing` : `${next.name} is checking`,
      shot: visual ? "generic" : undefined,
      sessions: team(
        stack,
        staff,
        "Waiting",
        staff.map((_, at) =>
          at <= index + 1 ? "Done" : at === index + 2 ? "Checking" : "Waiting",
        ),
      ),
      event: {
        who: checker.name,
        what: "checked it",
        text: `${sentence(checker.does)} Nothing off.`,
        attachment: visual ? { shot: "generic" } : undefined,
      },
    };
  });

  return [
    {
      wait: 1,
      now: `${writer.name} is reading`,
      sessions: team(stack, staff, "Planned it", ["Reading"]),
      event: {
        who: writer.name,
        what: "started",
        text: "Reading the component and the tokens it uses.",
      },
    },
    {
      wait: 2,
      now: `${writer.name} is writing`,
      sessions: team(stack, staff, "Planned it", ["Writing"]),
      event: {
        who: writer.name,
        what: "found the cause",
        text: "A hard-coded value where a token belongs.",
      },
    },
    {
      wait: 2,
      now:
        checkers[0] === undefined ? `${lead.name} is reviewing` : `${checkers[0].name} is checking`,
      files: [
        { path: "packages/app/src/chrome/sidebar.stylex.ts", added: 3, removed: 2 },
        { path: "packages/ui/src/styles/schema.stylex.ts", added: 1, removed: 0 },
      ],
      sessions: team(stack, staff, "Waiting", ["Done", "Checking"]),
      event: {
        who: writer.name,
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
    ...checks_,
    {
      wait: 2,
      number,
      status: "watching",
      now: "CI running",
      checks: PENDING,
      sessions: team(stack, staff, "Opened the PR", doneAll),
      event: {
        who: lead.name,
        what: `reviewed it and opened #${String(number)}`,
        text: "Reads the right tokens, and nothing else depends on the old value.",
      },
    },
    { wait: 1, now: "CI 3 of 6", checks: checks(3) },
    {
      wait: 2,
      now: "CI passed",
      checks: GREEN,
      event: {
        who: WATCHER,
        what: "CI passed",
        text: "Watched without a model. All six checks passed on the first run.",
        attachment: { checks: GREEN },
      },
    },
    {
      wait: 1,
      status: "needs-you",
      now: "Ready for your eyes",
      shot: "generic",
      ask: lookAsk(stack, number, staff, rounds),
      event: {
        who: lead.name,
        what: "took screenshots",
        text: "Light and dark, before and after.",
        attachment: { shot: "generic" },
      },
    },
  ];
}

export function lookAsk(
  stack: Stack,
  number: number,
  staff: readonly Agent[],
  rounds: number,
): Ask {
  const writer = staff[0] ?? leadAgent(stack);

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
        now: `${writer.name} is revising`,
        event: {
          who: "You",
          what: "sent it back",
          text: `Tell ${writer.name} what's off in the reply below.`,
          mine: true,
        },
        after: revisionSteps(stack, number, staff, rounds),
      },
    ],
  };
}

/** Revise, review again, rerun CI, then ask again; `rounds` bounds how often it can come back. */
export function revisionSteps(
  stack: Stack,
  number: number,
  staff: readonly Agent[],
  rounds: number,
): readonly Step[] {
  const lead = leadAgent(stack);
  const writer = staff[0] ?? lead;

  if (rounds === 0) return [];

  return [
    {
      wait: 3,
      now: `${lead.name} is reviewing`,
      event: {
        who: writer.name,
        what: "revised it",
        text: "Pushed a second commit with your note.",
      },
    },
    {
      wait: 2,
      status: "watching",
      now: "CI running",
      checks: PENDING,
      event: { who: lead.name, what: "approved", text: "The revision holds up." },
    },
    { wait: 3, now: "CI passed", checks: GREEN },
    {
      wait: 1,
      status: "needs-you",
      now: "Ready for your eyes",
      shot: "generic",
      ask: lookAsk(stack, number, staff, rounds - 1),
      event: {
        who: lead.name,
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

/** Nyte watches CI; whoever is staffed fixes what fails, asking first on a teammate's branch. */
export function babysitSteps(
  stack: Stack,
  pull: PullRequest,
  mine: boolean,
  staff: readonly Agent[],
): readonly Step[] {
  const lead = leadAgent(stack);
  const fixer = staff[0] ?? lead;
  const first = pull.author.name.split(" ")[0] ?? pull.author.name;

  const lead_: readonly Step[] = [
    {
      wait: 1,
      now: "CI 1 of 6",
      checks: checks(1),
      sessions: [sessionFor(fixer, "Asleep until something fails", 0, fixer === lead)],
    },
    {
      wait: 2,
      now: "lint failed",
      checks: checks(1, ["lint"]),
      sessions: [sessionFor(fixer, "Fixing lint", 2, fixer === lead)],
      event: {
        who: WATCHER,
        what: "saw a failure",
        text: `lint failed on an unused import this pull request added. Woke ${fixer.name}.`,
        attachment: { checks: [{ name: "lint", outcome: "failed" }] },
      },
    },
  ];

  if (mine)
    return [
      ...lead_,
      {
        wait: 1,
        now: "CI running",
        checks: PENDING,
        event: {
          who: fixer.name,
          what: "pushed a fix",
          text: "Removed the unused import. CI is running again.",
        },
      },
      { wait: 2, now: "CI 4 of 6", checks: checks(4) },
      {
        wait: 2,
        now: "CI passed",
        checks: GREEN,
        event: { who: WATCHER, what: "CI passed", text: "Green.", attachment: { checks: GREEN } },
      },
      { wait: 1, status: "needs-you", now: "Ready to merge", ask: mergeAsk(pull.number) },
    ];

  return [
    ...lead_,
    {
      wait: 1,
      status: "needs-you",
      now: `Push the fix to ${first}'s branch?`,
      ask: {
        question: `${fixer.name} has a one-line fix for the unused import. Push it to ${first}'s branch?`,
        answers: [
          {
            label: "Push It",
            primary: true,
            status: "watching",
            now: "CI running",
            checks: PENDING,
            event: {
              who: fixer.name,
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
                  who: WATCHER,
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
              who: lead.name,
              what: "commented",
              text: `Told ${first} which import to remove.`,
            },
            after: [
              {
                wait: 4,
                now: "CI running",
                checks: PENDING,
                event: { who: WATCHER, what: "saw a push", text: `${first} pushed the fix.` },
              },
              {
                wait: 3,
                now: "Waiting on review",
                checks: GREEN,
                event: {
                  who: WATCHER,
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

/** Whoever is staffed runs the branch and screenshots it; the lead turns that into findings. */
export function reviewSteps(
  stack: Stack,
  pull: PullRequest,
  staff: readonly Agent[],
): readonly Step[] {
  const lead = leadAgent(stack);
  const runner = staff[0] ?? lead;
  const first = pull.author.name.split(" ")[0] ?? pull.author.name;
  const shot = pull.number === 489 ? "empty-state" : "generic";
  const findings = pull.number === 489 ? EMPTY_STATE_FINDINGS : GENERIC_FINDINGS;

  const sessions = (state: string): readonly Session[] => [
    sessionFor(lead, state === "Done" ? "Wrote findings" : "Waiting", 2, true),
    ...staff.map((agent, index) => sessionFor(agent, index === 0 ? state : "Done", 4)),
  ];

  return [
    {
      wait: 1,
      now: `${runner.name} is running it`,
      sessions: sessions("Running the branch"),
      event: {
        who: runner.name,
        what: "checked it out",
        text: `Running ${pull.branch === "" ? "the branch" : pull.branch} in its own worktree.`,
      },
    },
    {
      wait: 2,
      now: "Comparing with main",
      shot,
      sessions: sessions("Comparing"),
      event: {
        who: runner.name,
        what: "took screenshots",
        text: "Main and this branch, light and dark.",
        attachment: { shot },
      },
    },
    ...staff.slice(1).map((checker) => ({
      wait: 1,
      event: { who: checker.name, what: "looked too", text: sentence(checker.does) },
    })),
    {
      wait: 2,
      status: "needs-you",
      now: `${String(findings.length)} findings for ${first}`,
      findings,
      sessions: sessions("Done"),
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
        who: lead.name,
        what: `found ${String(findings.length)} things`,
        text: "Two worth fixing and a nit. Untick what you'd rather not send.",
        attachment: { findings: true },
      },
    },
  ];
}
