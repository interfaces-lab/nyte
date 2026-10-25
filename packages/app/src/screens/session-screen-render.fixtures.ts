import type { Delivery, Message, RunView, SessionView, ToolClass, TurnInfo } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { USAGE, endedTurn, settledTool } from "../../test/view-fixtures.ts";

export const ID = asId<"session">("session-screen-render");

export const TURNS = 32;

export const TALL_PROMPT = 20;

export const liveRun: RunView = {
  id: asId<"run">("live-run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  configuration: {
    kind: "exact",
    model: { provider: "test", id: "test" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  },
  origin: { kind: "input", message: asId<"message">("prompt-32") },
};

export const turnId = (index: number) => asId<"turn">(`turn-${String(index)}`);

export type UserMessage = Extract<Message, { readonly kind: "user" }>;

export function user(
  id: string,
  turn: number,
  text: string,
  delivery: Delivery = "queue",
): UserMessage {
  return {
    id: asId<"message">(id),
    turn: turnId(turn),
    at: turn,
    kind: "user",
    content: text,
    source: { kind: "user" },
    delivery,
    status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

export function prose(id: string, turn: number, markdown: string, live = false): Message {
  return {
    id: asId<"message">(id),
    turn: turnId(turn),
    at: turn,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: liveRun.id }
      : { kind: "settled", commit: asId<"commit">(id), endedAt: turn },
  };
}

function tool(id: string, turn: number, toolClass: ToolClass): Message {
  return { ...settledTool(id, toolClass, "ok"), turn: turnId(turn) };
}

export const sentence = "The transcript holds its place while replies stream in below the reader. ";

export function paragraphs(seed: number): string {
  return Array.from(
    { length: 1 + (seed % 3) },
    (_, index) =>
      `Paragraph ${String(index + 1)} of turn ${String(seed)}. ${sentence.repeat(1 + ((seed + index) % 4))}`,
  ).join("\n\n");
}

function prompt(index: number): UserMessage {
  const lines = index === TALL_PROMPT ? 60 : 2;

  return user(
    `prompt-${String(index)}`,
    index,
    `Question ${String(index)}\n${"Line of the prompt\n".repeat(lines)}`,
  );
}

function turnMessages(index: number): Message[] {
  const file = `src/file-${String(index)}.ts`;
  const messages: Message[] = [prompt(index)];

  if (index % 2 === 1) {
    messages.push(tool(`read-${String(index)}`, index, { kind: "read", path: file }));
    messages.push(tool(`edit-${String(index)}`, index, { kind: "edit", path: file }));
  }

  messages.push(prose(`answer-${String(index)}`, index, paragraphs(index)));

  if (index % 7 === 0) {
    messages.push(user(`steer-${String(index)}`, index, `Steering note ${String(index)}`, "steer"));
    messages.push(prose(`followup-${String(index)}`, index, `After steering ${String(index)}.`));
  }

  return messages;
}

const continuation = asId<"turn">("continuation-10");

export const ended: TurnInfo["state"] = { kind: "ended", end: { kind: "completed", usage: USAGE } };

export function view(
  liveText: string,
  extra: readonly Message[] = [],
  extraTurns: readonly TurnInfo[] = [],
): SessionView {
  const messages: Message[] = [];
  const turns: TurnInfo[] = [];

  for (let index = 1; index <= TURNS; index += 1) {
    const live = index === TURNS;

    const own = live
      ? [
          prompt(index),
          tool(`read-${String(index)}`, index, { kind: "shell", command: "pnpm test" }),
          tool(`edit-${String(index)}`, index, { kind: "edit", path: "src/file.ts" }),
          prose(`answer-${String(index)}`, index, "A short first answer."),
          user(`steer-${String(index)}`, index, "Keep going, but shorter.", "steer"),
          prose(`live-${String(index)}`, index, liveText, true),
        ]
      : turnMessages(index);

    messages.push(...own);
    turns.push(
      endedTurn([], {
        id: turnId(index),
        prompt: asId<"message">(`prompt-${String(index)}`),
        run: live ? liveRun.id : null,
        state: live ? { kind: "working", activity: null } : ended,
        steps: own.length,
      }).info,
    );

    if (index === 10) {
      const report = tool("report-10", 10, { kind: "shell", command: "git status" });
      messages.push({ ...report, turn: continuation });
      messages.push({
        ...prose("report-text-10", 10, "Background report folded in."),
        turn: continuation,
      });
      turns.push(endedTurn([], { id: continuation, prompt: null, steps: 2 }).info);
    }
  }

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [...messages, ...extra],
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: [...turns, ...extraTurns],
    usage: USAGE,
    execution: { kind: "live", run: liveRun, phase: "responding", stopping: false },
    reportsHeld: false,
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}
