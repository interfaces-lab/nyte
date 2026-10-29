import type { Message, SessionView, TurnInfo } from "@nyte-ai/sdk";

export interface TurnMessages {
  readonly info: TurnInfo;
  readonly messages: readonly Message[];
  /** Whether messages between the turn's prompt and its first message here are not loaded yet. */
  readonly clipped: boolean;
}

/** Each of `view`'s turns with its messages; the turn `leadingPrompt` leads starts with it and is clipped. */
export function conversationTurns(view: SessionView): readonly TurnMessages[] {
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
