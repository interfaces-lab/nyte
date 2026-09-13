import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo } from "@nyte-ai/core";
import { keys } from "./query-keys.ts";

/** Share session existence reads between route preloads and the navigation they precede. */
export function readRouteSession({
  client,
  sessionId,
  read,
}: {
  readonly client: QueryClient;
  readonly sessionId: SessionId;
  readonly read: () => Promise<SessionInfo | undefined>;
}): Promise<SessionInfo | null> {
  return client.query({
    queryKey: keys.session(sessionId),
    queryFn: async () => (await read()) ?? null,
    staleTime: Infinity,
  });
}
