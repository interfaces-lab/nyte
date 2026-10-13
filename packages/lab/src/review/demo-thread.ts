/**
 * The side chat's demo: a scripted turn drawn by the same components as a
 * real one, so the transcript, the working group and its summary can be
 * tried without a model call. The turn is built whole when the message is
 * sent; playing it reveals one part at a time.
 */
import { isToolMessage, type ConversationTurn } from "@nyte-ai/app/view-helpers.ts";
import { lineDiff } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Json, Message, PatchEntry, ToolClass, TurnInfo } from "@nyte-ai/sdk";

/** Who answers: a fork of the guide, which only reads, or Nyte, which edits the branch. */
export type Recipient = "reviewer" | "nyte";

/** A scripted turn and how many of its messages have played. */
export interface DemoExchange {
  readonly turn: ConversationTurn;
  readonly shown: number;
}

/** How long each part shows before the next lands. */
export const PART_MS = 700;

export const playing = ({ turn, shown }: DemoExchange): boolean => shown < turn.messages.length;

function cut(
  { turn, shown }: DemoExchange,
  state: TurnInfo["state"],
  last: "running" | "stopped",
): ConversationTurn {
  const messages = turn.messages.slice(0, shown).map((message, index): Message => {
    if (index !== shown - 1 || !isToolMessage(message)) return message;
    const { call, name, args } = message.state;
    const base = { call, name, args, class: message.state.class };

    return last === "running"
      ? {
          ...message,
          state: { ...base, phase: "running", progress: null },
          status: { kind: "live", run: null },
        }
      : {
          ...message,
          state: { ...base, phase: "settled", outcome: { kind: "stopped" }, changes: null },
        };
  });

  return { info: { ...turn.info, state }, messages };
}

/** What has played so far; the newest call runs until the next part lands. */
export function shownTurn(exchange: DemoExchange): ConversationTurn {
  return playing(exchange)
    ? cut(exchange, { kind: "working", activity: null }, "running")
    : exchange.turn;
}

/** Cut the turn where it stands; a call it was in reads as stopped. */
export function stop(exchange: DemoExchange): DemoExchange {
  const turn = cut(exchange, { kind: "ended", end: { kind: "stopped" } }, "stopped");

  return { turn, shown: turn.messages.length };
}

type Step =
  | { readonly kind: "thinking" | "assistant"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly class: ToolClass;
      readonly args?: Json;
      readonly changes?: {
        readonly added: number;
        readonly removed: number;
        readonly paths: readonly string[];
      };
      readonly output?: string;
      /** The patch an edit settles with as its output. */
      readonly patch?: PatchEntry;
    };

function script(recipient: Recipient, text: string, paths: readonly string[]): readonly Step[] {
  const [first = "README.md", second = first] = paths;
  const folder = first.split("/").slice(0, -1).join("/") || ".";

  const word =
    text.match(/[A-Za-z_][\w.]{3,}/g)?.toSorted((left, right) => right.length - left.length)[0] ??
    "export";

  if (recipient === "reviewer")
    return [
      {
        kind: "thinking",
        text: "**Starting from the guide**\n\nThe brief already read the patch, so only the files the question touches need another look.",
      },
      { kind: "tool", class: { kind: "read", path: first } },
      {
        kind: "tool",
        class: { kind: "shell", command: `rg -n "${word}" ${folder}` },
        output: `${first}:42:  ${word}`,
      },
      { kind: "tool", class: { kind: "read", path: second } },
      {
        kind: "assistant",
        text: `It starts in \`${first}\`. The change moves the work there, and \`${second}\` only reads the result, so that is where to look.`,
      },
      {
        kind: "assistant",
        text: "This reply is scripted. Turn Demo off to ask a fork of the guide: it starts from everything the guide read, so only the question is new.",
      },
    ];
  const oldText = `  ${word}`;
  const newText = `  // ${text.split("\n")[0]?.slice(0, 60) ?? ""}\n  ${word}\n`;

  return [
    {
      kind: "thinking",
      text: "**Planning the change**\n\nOne file takes the edit, and its tests cover it.",
    },
    { kind: "tool", class: { kind: "read", path: second } },
    {
      kind: "tool",
      class: { kind: "edit", path: first },
      args: { path: first, edits: [{ oldText, newText }] },
      changes: { added: 3, removed: 1, paths: [first] },
      patch: {
        path: first,
        status: "modified",
        digest: first,
        kind: "text",
        ...lineDiff(oldText, newText),
      },
    },
    {
      kind: "tool",
      class: { kind: "shell", command: "pnpm test" },
      output: "Test Files  12 passed (12)\n     Tests  86 passed (86)",
    },
    {
      kind: "assistant",
      text: `Done. \`${first}\` has the change and the tests pass. I committed it on the branch, so the guide shows it as new commits.`,
    },
    {
      kind: "assistant",
      text: "This reply is scripted. Nothing was edited or committed.",
    },
  ];
}

/** The whole scripted turn answering `text`, ready to play. */
export function demoTurn({
  text,
  recipient,
  paths,
}: {
  readonly text: string;
  readonly recipient: Recipient;
  readonly paths: readonly string[];
}): DemoExchange {
  const id = crypto.randomUUID();
  const turn = asId<"turn">(id);
  const prompt = asId<"message">(`${id}:user`);
  const at = Date.now();
  const steps = script(recipient, text, paths);

  const settled = (key: string, when: number) =>
    ({ kind: "settled", commit: asId<"commit">(key), endedAt: when }) as const;

  const parts = steps.map((step, index): Message => {
    const key = `${id}:${index}`;
    const when = at + (index + 1) * PART_MS;

    const common = {
      kind: "part",
      id: asId<"message">(key),
      turn,
      at: when,
      part: asId<"part">(key),
      version: 1,
      status: settled(key, when),
    } as const;

    if (step.kind === "tool")
      return {
        ...common,
        partKind: "tool",
        role: "step",
        state: {
          call: asId<"call">(key),
          name: step.class.kind,
          args: step.args ?? null,
          class: step.class,
          phase: "settled",
          outcome: {
            kind: "ok",
            content: step.output === undefined ? [] : [{ kind: "text", text: step.output }],
            output: step.patch ?? null,
            parts: [],
          },
          changes: step.changes ?? null,
        },
      };

    if (step.kind === "thinking")
      return {
        ...common,
        partKind: "thinking",
        role: "step",
        state: { markdown: step.text, merged: 1, signature: null },
      };

    return {
      ...common,
      partKind: "text",
      role: "answer",
      state: { markdown: step.text, signature: null },
    };
  });

  const tools = steps.flatMap((step) => (step.kind === "tool" ? [step.class] : []));

  const tally = (kind: ToolClass["kind"]) => {
    const matched = tools.filter((entry) => entry.kind === kind);

    return {
      count: matched.length,
      paths: matched.flatMap((entry) => ("path" in entry ? [entry.path] : [])),
    };
  };

  const byClass = {
    read: tally("read"),
    list: tally("list"),
    edit: tally("edit"),
    shell: tally("shell"),
    delegate: tally("delegate"),
    custom: tally("custom"),
  };

  return {
    turn: {
      info: {
        id: turn,
        run: null,
        prompt,
        state: {
          kind: "ended",
          end: {
            kind: "completed",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: null,
              total: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        },
        startedAt: at,
        endedAt: at + parts.length * PART_MS,
        steps: steps.filter((step) => step.kind !== "assistant").length,
        thinkingOnly: false,
        summary: {
          byClass,
          failed: 0,
          stopped: 0,
          added: steps.reduce(
            (sum, step) => sum + (step.kind === "tool" ? (step.changes?.added ?? 0) : 0),
            0,
          ),
          removed: steps.reduce(
            (sum, step) => sum + (step.kind === "tool" ? (step.changes?.removed ?? 0) : 0),
            0,
          ),
        },
      },
      messages: [
        {
          kind: "user",
          id: prompt,
          turn,
          at,
          content: text,
          source: { kind: "user" },
          delivery: "queue",
          status: {
            kind: "landed",
            commit: asId<"commit">(`${id}:user`),
            run: null,
            replaced: null,
          },
          siblings: { index: 0, count: 1, ids: [] },
        },
        ...parts,
      ],
    },
    shown: 1,
  };
}
