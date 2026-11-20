import type { ActOutcome, PartView, SessionId, SessionView } from "@nyte-ai/sdk";
import type { WaitingChat } from "../../chats/index.ts";

export interface Ask<T> {
  readonly sessionId: SessionId;
  readonly request: T;
  readonly origin: { readonly title: string; readonly sessionId: SessionId } | undefined;
}

export function openAsks<T>(
  open: (view: Pick<SessionView, "parts"> | undefined) => readonly T[],
  own: { readonly sessionId: SessionId; readonly parts: readonly PartView[] | undefined },
  waiting: readonly WaitingChat[],
): readonly Ask<T>[] {
  return [
    ...open({ parts: own.parts ?? [] }).map((request) => ({
      sessionId: own.sessionId,
      request,
      origin: undefined,
    })),
    ...waiting.flatMap((entry) =>
      open(entry).map((request) => ({
        sessionId: entry.id,
        request,
        origin: { title: entry.title, sessionId: entry.id },
      })),
    ),
  ];
}

const ASK_WORDS = {
  approval: {
    closed: "This request is no longer waiting.",
    "no-owner": "This host can't answer tool approvals.",
    "unknown-action": "This host can't answer tool approvals.",
  },
  question: {
    closed: "This question is no longer waiting.",
    "no-owner": "This host cannot answer these questions yet.",
    "unknown-action": "Question answers are unavailable on this host.",
  },
  secret: {
    closed: "This request is no longer waiting.",
    "no-owner": "This host can't take secrets from a chat.",
    "unknown-action": "This host can't take secrets from a chat.",
  },
} as const satisfies Readonly<
  Record<string, Readonly<Record<"closed" | "no-owner" | "unknown-action", string>>>
>;

export function requireAnswered(outcome: ActOutcome<unknown>, ask: keyof typeof ASK_WORDS): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "rejected":
      throw new Error(outcome.reason);
    case "failed":
      throw new Error(outcome.message);
    case "closed":
    case "no-owner":
    case "unknown-action":
      throw new Error(ASK_WORDS[ask][outcome.kind]);
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}
