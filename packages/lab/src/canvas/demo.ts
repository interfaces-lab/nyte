import { asId } from "@nyte-ai/schema";
import type { ConversationTurn } from "@nyte-ai/app/view-helpers.ts";
import type { Message } from "@nyte-ai/sdk";
import type { CanvasSnapshot } from "./wire";

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

const noUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const noClasses = {
  read: { count: 0, paths: [] },
  list: { count: 0, paths: [] },
  edit: { count: 0, paths: [] },
  shell: { count: 0, paths: [] },
  delegate: { count: 0, paths: [] },
  custom: { count: 1, paths: [] },
};

function settled(id: string, at: number) {
  return { kind: "settled", commit: asId<"commit">(id), endedAt: at } as const;
}

export function demoTurns(snapshots: readonly CanvasSnapshot[]): readonly ConversationTurn[] {
  return snapshots.flatMap((snapshot, index) => {
    const script = demoSources[index];

    if (script === undefined) return [];
    const id = `demo:${snapshot.id}`;
    const turn = asId<"turn">(id);
    const at = index * 10_000;
    const prompt = asId<"message">(`${id}:user`);

    const messages: readonly Message[] = [
      {
        kind: "user",
        id: prompt,
        turn,
        at,
        content: script.question,
        source: { kind: "user" },
        delivery: "queue",
        status: { kind: "landed", commit: asId<"commit">(`${id}:user`), run: null, replaced: null },
        siblings: { index: 0, count: 1, ids: [] },
      },
      {
        kind: "part",
        id: asId<"message">(`${id}:thinking`),
        turn,
        at: at + 700,
        part: asId<"part">(`${id}:thinking`),
        partKind: "thinking",
        role: "step",
        state: {
          markdown: "A chart will make the comparison easier to read.",
          merged: 1,
          signature: null,
        },
        version: 1,
        status: settled(`${id}:thinking`, at + 1400),
      },
      {
        kind: "part",
        id: asId<"message">(`${id}:canvas`),
        turn,
        at: at + 1400,
        part: asId<"part">(`${id}:canvas`),
        partKind: "tool",
        role: "step",
        state: {
          call: asId<"call">(`${id}:canvas`),
          name: "canvas",
          args: {},
          class: { kind: "custom", label: "Canvas" },
          phase: "settled",
          outcome: {
            kind: "ok",
            content: [{ kind: "text", text: `canvas:${snapshot.id}\nShown above the reply.` }],
            output: null,
            parts: [],
          },
          changes: null,
        },
        version: 1,
        status: settled(`${id}:published`, at + 2000),
      },
      {
        kind: "part",
        id: asId<"message">(`${id}:reply`),
        turn,
        at: at + 2100,
        part: asId<"part">(`${id}:reply`),
        partKind: "text",
        role: "answer",
        state: { markdown: script.reply, signature: null },
        version: 1,
        status: settled(`${id}:reply`, at + 2100),
      },
    ];

    return [
      {
        info: {
          id: turn,
          run: null,
          prompt,
          state: { kind: "ended", end: { kind: "completed", usage: noUsage } },
          startedAt: at,
          endedAt: at + 2100,
          steps: 2,
          thinkingOnly: false,
          summary: { byClass: noClasses, failed: 0, stopped: 0, added: 0, removed: 0 },
        },
        messages,
      },
    ];
  });
}

export function revealDemo(
  turns: readonly ConversationTurn[],
  shown: number,
): readonly ConversationTurn[] {
  return turns.flatMap((turn, index) => {
    const count = Math.max(0, shown - index * 4);

    return count === 0 ? [] : [{ ...turn, messages: turn.messages.slice(0, count) }];
  });
}
