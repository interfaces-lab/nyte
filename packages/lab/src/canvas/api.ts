import { sdk, type Connection, type SessionId, type SessionView } from "@nyte-ai/sdk";
import { experimental_streamedQuery, useQuery } from "@tanstack/react-query";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { CanvasSnapshotSchema } from "./wire";

const SessionSchema = Type.Object({ sessionId: Type.String(), model: Type.String() });

const ErrorSchema = Type.Object({ error: Type.String() });

export async function canvasRequest<T extends TSchema>(
  schema: T,
  path: string,
  body?: { readonly title: string; readonly source: string } | { readonly prompt: string },
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

/** Start a live canvas chat with its first message. */
export const startCanvasSession = (prompt: string) =>
  canvasRequest(SessionSchema, "/session", { prompt });

let client: Promise<Connection> | undefined;

export function canvasClient(): Promise<Connection> {
  client ??= sdk.connect({
    url: new URL("/core/nyte", location.origin).href,
    credentials: { kind: "custom", headers: () => ({}) },
  });

  return client;
}

async function* canvasViews(sessionId: SessionId) {
  const connection = await canvasClient();

  yield* connection.session(sessionId).watch();
}

export function useCanvasSession(sessionId: SessionId | undefined) {
  const view = useQuery({
    queryKey: ["canvas", "session", sessionId],
    queryFn: experimental_streamedQuery({
      streamFn: () => (sessionId === undefined ? emptyStream() : canvasViews(sessionId)),
      reducer: (_previous: SessionView | undefined, next: SessionView) => next,
      initialValue: undefined,
      refetchMode: "replace",
    }),
    enabled: sessionId !== undefined,
    retry: 3,
  });

  return { view: view.data, error: view.error };
}

async function* emptyStream(): AsyncGenerator<SessionView> {}
