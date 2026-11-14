import type { PartView, SessionId, SessionView } from "@nyte-ai/sdk";
import type { WaitingChat } from "../../chats/index.ts";

export interface Ask<T> {
  readonly sessionId: SessionId;
  readonly request: T;
  readonly origin: { readonly title: string; readonly sessionId: SessionId } | undefined;
}

/** The chat's own open asks first, then each waiting descendant's in the walk's order. */
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
      open(entry.view).map((request) => ({
        sessionId: entry.id,
        request,
        origin: { title: entry.title, sessionId: entry.id },
      })),
    ),
  ];
}
