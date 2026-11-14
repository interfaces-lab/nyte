import type { SessionId } from "@nyte-ai/sdk";

/** The chats held open with nobody drawing them: `kept` the newest chats a pane showed, `warm` the ones a person may open next, each until its time. Oldest first. */
export interface ChatHolds {
  readonly kept: readonly SessionId[];
  readonly warm: readonly { readonly session: SessionId; readonly until: number }[];
}

export type HoldEvent =
  | { readonly kind: "keep"; readonly session: SessionId }
  | { readonly kind: "warm"; readonly session: SessionId; readonly now: number }
  | { readonly kind: "tick"; readonly now: number }
  | { readonly kind: "gone"; readonly session: SessionId }
  | { readonly kind: "replaced" };

const KEPT_CHATS = 8;

const WARM_SESSIONS = 3;

const WARM_MS = 5_000;

export const NO_HOLDS: ChatHolds = { kept: [], warm: [] };

/** Keeping or warming a chat makes it the newest of its kind and drops the oldest past the limit; a warm hold lapses at its `until`; a chat the host no longer has drops from both; a replaced connection drops the kept ones and leaves the warm ones. */
export function nextHolds(holds: ChatHolds, event: HoldEvent): ChatHolds {
  switch (event.kind) {
    case "keep":
      return {
        kept: [...holds.kept.filter((session) => session !== event.session), event.session].slice(
          -KEPT_CHATS,
        ),
        warm: holds.warm,
      };
    case "warm":
      return {
        kept: holds.kept,
        warm: [
          ...holds.warm.filter((hold) => hold.session !== event.session),
          { session: event.session, until: event.now + WARM_MS },
        ].slice(-WARM_SESSIONS),
      };
    case "tick":
      return { kept: holds.kept, warm: holds.warm.filter((hold) => hold.until > event.now) };
    case "gone":
      return {
        kept: holds.kept.filter((session) => session !== event.session),
        warm: holds.warm.filter((hold) => hold.session !== event.session),
      };
    case "replaced":
      return { kept: [], warm: holds.warm };
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

export function heldSessions(holds: ChatHolds): ReadonlySet<SessionId> {
  return new Set([...holds.kept, ...holds.warm.map((hold) => hold.session)]);
}

/** When the first warm hold lapses, or `null` with none. */
export function nextExpiry(holds: ChatHolds): number | null {
  return holds.warm.length === 0 ? null : Math.min(...holds.warm.map((hold) => hold.until));
}
