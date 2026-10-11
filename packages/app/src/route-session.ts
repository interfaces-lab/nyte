import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { SdkError } from "@nyte-ai/sdk";
import { keys } from "./query-keys.ts";

/** Share session existence reads between route preloads and the navigation they precede; null when the host has no such session. */
export function readRouteSession({
  client,
  sessionId,
  read,
}: {
  readonly client: QueryClient;
  readonly sessionId: SessionId;
  readonly read: () => Promise<SessionInfo>;
}): Promise<SessionInfo | null> {
  return client.query({
    queryKey: keys.session(sessionId),
    queryFn: () => read().catch(missingAsNull),
    staleTime: Infinity,
  });
}

/** A read the host answered `unknown` as null: the session is gone. */
export function missingAsNull(cause: unknown): null {
  if (cause instanceof SdkError && cause.code === "unknown") return null;
  throw cause;
}
