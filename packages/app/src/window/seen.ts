import type { CommitId, SessionId } from "@nyte-ai/sdk";
import type { ChatDirectory } from "../chats/index.ts";

export interface SeenStep {
  readonly sent: ReadonlyMap<SessionId, CommitId>;
  readonly see: readonly SessionId[];
}

export function toSee(
  sent: ReadonlyMap<SessionId, CommitId>,
  looking: ReadonlySet<SessionId>,
  chats: ChatDirectory,
  ready: (id: SessionId) => boolean,
): SeenStep {
  const tips = new Map(
    [...looking].flatMap((id) => {
      const tip = chats.get(id)?.unreadTip;

      return tip === undefined || tip === null || !ready(id) ? [] : [[id, tip.commit] as const];
    }),
  );

  return {
    sent: tips,
    see: [...tips].flatMap((entry) => (sent.get(entry[0]) === entry[1] ? [] : [entry[0]])),
  };
}
