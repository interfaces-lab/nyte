import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { SdkError } from "@nyte-ai/sdk";
import { keys } from "./query-keys.ts";

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

export function missingAsNull(cause: unknown): null {
  if (cause instanceof SdkError && cause.code === "unknown") return null;
  throw cause;
}

export async function routeSessionExists({
  client,
  sessionId,
  listed,
  read,
}: {
  readonly client: QueryClient;
  readonly sessionId: SessionId;
  readonly listed: () => Promise<readonly SessionInfo[]>;
  readonly read: () => Promise<SessionInfo>;
}): Promise<boolean> {
  const directory = await listed();

  if (directory.some((session) => session.id === sessionId)) return true;

  return (await readRouteSession({ client, sessionId, read })) !== null;
}
