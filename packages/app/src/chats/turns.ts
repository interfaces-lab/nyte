import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { Message, TurnInfo } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";

export interface TurnMessages {
  readonly info: TurnInfo;
  readonly messages: readonly Message[];
  readonly clipped: boolean;
}

export function conversationTurns(view: HeadView): readonly TurnMessages[] {
  const byTurn = new Map<string, Message[]>();
  const lead = view.leadingPrompt;

  if (lead !== null) byTurn.set(lead.turn, [lead]);

  for (const message of view.messages) {
    const bucket = byTurn.get(message.turn) ?? [];
    bucket.push(message);
    byTurn.set(message.turn, bucket);
  }

  return view.turns.map((info) => ({
    info,
    messages: byTurn.get(info.id) ?? [],
    clipped: info.id === lead?.turn,
  }));
}

/** The paths a turn's settled tool calls changed, each once, in the order they first appear. */
export function turnChangedFiles(turn: TurnMessages): readonly string[] {
  return [
    ...new Set(
      turn.messages.flatMap((message) =>
        showsTool(message) && message.state.phase === "settled"
          ? (message.state.changes?.paths ?? [])
          : [],
      ),
    ),
  ];
}
