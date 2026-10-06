/**
 * The side chat's demo: a scripted turn drawn by the same components as a
 * real one, so the transcript, the working group and its summary can be
 * tried without a model call. The turn is built whole when the message is
 * sent; playing it reveals one part at a time.
 */
import type { ToolTurnPart, Turn, TurnPart } from "@nyte-ai/protocol";

type ConversationTurn = Extract<Turn, { readonly kind: "turn" }>;

/** Who answers: a fork of the guide, which only reads, or Nyte, which edits the branch. */
export type Recipient = "reviewer" | "nyte";

/** A scripted turn and how many of its parts have played. */
export interface DemoExchange {
  readonly turn: ConversationTurn;
  readonly shown: number;
}

/** How long each part shows before the next lands. */
export const PART_MS = 700;

export const playing = ({ turn, shown }: DemoExchange): boolean => shown < turn.parts.length;

function cut({ turn, shown }: DemoExchange, last: ToolTurnPart["state"]): ConversationTurn {
  const parts = turn.parts
    .slice(0, shown)
    .map((part, index) =>
      part.kind === "tool" && index === shown - 1 ? { ...part, state: last } : part,
    );

  return { ...turn, parts };
}

/** What has played so far; the newest call runs until the next part lands. */
export function shownTurn(exchange: DemoExchange): ConversationTurn {
  return playing(exchange) ? cut(exchange, { kind: "running" }) : exchange.turn;
}

/** Cut the turn where it stands; a call it was in reads as stopped. */
export function stop(exchange: DemoExchange): DemoExchange {
  const turn = cut(exchange, { kind: "error", reason: { kind: "cancelled" }, commit: null });

  return { turn, shown: turn.parts.length };
}

type Step =
  | { readonly kind: "thinking" | "assistant"; readonly text: string }
  | { readonly kind: "tool"; readonly class: ToolTurnPart["class"]; readonly output?: string };

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
      { kind: "tool", class: { kind: "file_read", path: first } },
      {
        kind: "tool",
        class: { kind: "shell", command: `rg -n "${word}" ${folder}` },
        output: `${first}:42:  ${word}`,
      },
      { kind: "tool", class: { kind: "file_read", path: second } },
      {
        kind: "assistant",
        text: `It starts in \`${first}\`. The change moves the work there, and \`${second}\` only reads the result, so that is where to look.`,
      },
      {
        kind: "assistant",
        text: "This reply is scripted. Turn Demo off to ask a fork of the guide: it starts from everything the guide read, so only the question is new.",
      },
    ];

  return [
    {
      kind: "thinking",
      text: "**Planning the change**\n\nOne file takes the edit, and its tests cover it.",
    },
    { kind: "tool", class: { kind: "file_read", path: second } },
    {
      kind: "tool",
      class: {
        kind: "file_patch",
        op: "edit",
        path: first,
        added: 3,
        removed: 1,
        patch: [
          `--- a/${first}`,
          `+++ b/${first}`,
          "@@ -40,3 +40,5 @@",
          " ",
          `-  ${word}`,
          `+  // ${text.split("\n")[0]?.slice(0, 60) ?? ""}`,
          `+  ${word}`,
          "+",
          " ",
        ].join("\n"),
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
  const at = Date.now();
  const steps = script(recipient, text, paths);

  const parts = steps.map((step, index): TurnPart => {
    const commit = `${id}:${index}`;
    const when = at + (index + 1) * PART_MS;

    if (step.kind === "tool")
      return {
        kind: "tool",
        callId: commit,
        at: when,
        class: step.class,
        state: { kind: "success", commit },
        output: step.output,
      };

    return { kind: step.kind, commit, contentIndex: index, text: step.text, at: when };
  });

  return {
    turn: {
      kind: "turn",
      id,
      run: { kind: "none" },
      parts: [{ kind: "user", commit: `${id}:user`, parent: null, content: text, at }, ...parts],
      startedAt: at,
      durationMs: parts.length * PART_MS,
    },
    shown: 1,
  };
}
