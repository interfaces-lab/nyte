import { createNyteClient, type NyteClient } from "@nyte-ai/client";
import { schemas, type SessionId } from "@nyte-ai/protocol";
import { experimental_streamedQuery, useQuery } from "@tanstack/react-query";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { CanvasSnapshotSchema } from "./wire";

const SessionSchema = Type.Object({ sessionId: schemas.SessionId, model: Type.String() });

const ErrorSchema = Type.Object({ error: Type.String() });

export async function canvasRequest<T extends TSchema>(
  schema: T,
  path: string,
  body?: { readonly title: string; readonly source: string } | Record<string, never>,
): Promise<Static<T>> {
  const response = await fetch(`/core/canvas${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const value: unknown = await response.json();

  if (response.ok && Value.Check(schema, value)) return value;
  throw new Error(
    Value.Check(ErrorSchema, value) ? value.error : "Canvas routes need the lab dev server.",
  );
}

export const compileDemo = (input: { readonly title: string; readonly source: string }) =>
  canvasRequest(CanvasSnapshotSchema, "/compile", input);

export const openCanvasSession = () => canvasRequest(SessionSchema, "/session", {});

let client: NyteClient | undefined;

export function canvasClient(): NyteClient {
  client ??= createNyteClient({ baseUrl: new URL("/core/nyte", location.origin).href });

  return client;
}

async function* emptyStream() {}

export function useCanvasSession(sessionId: SessionId | undefined) {
  const events = useQuery({
    queryKey: ["canvas", "events", sessionId],
    queryFn: experimental_streamedQuery({
      streamFn: ({ signal }) =>
        sessionId === undefined
          ? emptyStream()
          : canvasClient().watch({ sessionId, live: true, signal }),
      reducer: (version: number) => version + 1,
      initialValue: 0,
      refetchMode: "append",
    }),
    enabled: sessionId !== undefined,
    retry: 3,
  });

  const snapshot = useQuery({
    queryKey: ["canvas", "session", sessionId, events.data ?? 0],
    queryFn: () =>
      sessionId === undefined
        ? Promise.resolve(undefined)
        : canvasClient().sessions.snapshot({ sessionId }),
    enabled: sessionId !== undefined,
    placeholderData: (previous) => previous,
    staleTime: 0,
  });

  return { snapshot: snapshot.data, error: events.error ?? snapshot.error };
}
