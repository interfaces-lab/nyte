import type { Turn } from "@nyte-ai/protocol";
import type { CanvasSnapshot } from "./wire";

export type ConversationTurn = Extract<Turn, { readonly kind: "turn" }>;

export const demoSources = [
  {
    title: "April releases by region",
    question: "Compare April's release counts: North 42, South 31, East 56, West 38.",
    reply:
      "South is the outlier. Check whether its release queue is blocked before increasing the target.",
    source: `import { BarChart } from "nyte:canvas";
export default function Canvas() {
  return <BarChart title="April releases by region" data={[{label:"North",value:42},{label:"South",value:31},{label:"East",value:56},{label:"West",value:38}]} />;
}`,
  },
  {
    title: "Six-month customer retention (%)",
    question: "Show the retention trend too: Jan 82%, Feb 76%, Mar 71%, Apr 68%, May 65%, Jun 63%.",
    reply:
      "The decline is slowing, but it has not reversed. Compare cohorts before attributing the change to April's release.",
    source: `import { LineChart } from "nyte:canvas";
export default function Canvas() {
  return <LineChart title="Customer retention (%)" area points data={[{label:"Jan",value:82},{label:"Feb",value:76},{label:"Mar",value:71},{label:"Apr",value:68},{label:"May",value:65},{label:"Jun",value:63}]} />;
}`,
  },
  {
    title: "Where review time went last week",
    question:
      "Break down last week's 31 review hours: reading 14, waiting on CI 8, discussion 5, rework 4.",
    reply: "Reading dominates, so smaller pull requests would pay off before faster CI does.",
    source: `import { PieChart } from "nyte:canvas";
export default function Canvas() {
  return <PieChart title="Review hours" innerRadius={70} data={[{label:"Reading",value:14},{label:"Waiting on CI",value:8},{label:"Discussion",value:5},{label:"Rework",value:4}]} />;
}`,
  },
];

export function demoTurns(snapshots: readonly CanvasSnapshot[]): readonly ConversationTurn[] {
  return snapshots.flatMap((snapshot, index) => {
    const script = demoSources[index];

    if (script === undefined) return [];
    const id = `demo:${snapshot.id}`;
    const at = index * 10_000;

    return [
      {
        kind: "turn",
        id,
        run: { kind: "none" },
        startedAt: at,
        durationMs: 2100,
        parts: [
          { kind: "user", commit: `${id}:user`, parent: null, content: script.question, at },
          {
            kind: "thinking",
            commit: `${id}:thinking`,
            contentIndex: 0,
            text: "A chart will make the comparison easier to read.",
            at: at + 700,
          },
          {
            kind: "tool",
            callId: `${id}:canvas`,
            at: at + 1400,
            class: { kind: "custom", label: "Canvas" },
            state: { kind: "success", commit: `${id}:published` },
            output: `canvas:${snapshot.id}\nShown above the reply.`,
          },
          {
            kind: "assistant",
            commit: `${id}:reply`,
            contentIndex: 0,
            text: script.reply,
            at: at + 2100,
          },
        ],
      } satisfies ConversationTurn,
    ];
  });
}

export function revealDemo(
  turns: readonly ConversationTurn[],
  shown: number,
): readonly ConversationTurn[] {
  return turns.flatMap((turn, index) => {
    const count = Math.max(0, shown - index * 4);

    return count === 0 ? [] : [{ ...turn, parts: turn.parts.slice(0, count) }];
  });
}
