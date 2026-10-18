import { sdk, type Connection, type SessionId, type SessionView } from "@nyte-ai/sdk";
import { experimental_streamedQuery, useQuery } from "@tanstack/react-query";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const SessionSchema = Type.Object({ sessionId: Type.String(), model: Type.String() });

const ModelSchema = Type.Object({ model: Type.String() });

const ErrorSchema = Type.Object({ error: Type.String() });

async function studioRequest<T extends TSchema>(
  schema: T,
  path: string,
  body?: { readonly prompt: string },
): Promise<Static<T>> {
  const response = await fetch(`/core/studio${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const value: unknown = await response.json().catch(() => undefined);

  if (response.ok && Value.Check(schema, value)) return value;
  throw new Error(
    Value.Check(ErrorSchema, value)
      ? value.error
      : "The director runs in the lab's dev server: pnpm --dir packages/lab dev.",
  );
}

/** Start the director's session with its first message. */
export const startDirector = (prompt: string) =>
  studioRequest(SessionSchema, "/session", { prompt });

export function useDirectorModel() {
  return useQuery({
    queryKey: ["studio", "model"],
    queryFn: () => studioRequest(ModelSchema, "/model"),
    retry: false,
  });
}

let client: Promise<Connection> | undefined;

/** The lab core's SDK connection, which the director's session runs on. */
export function directorConnection(): Promise<Connection> {
  client ??= sdk.connect({
    url: new URL("/core/nyte", location.origin).href,
    credentials: { kind: "custom", headers: () => ({}) },
  });

  return client;
}

async function* views(sessionId: SessionId): AsyncGenerator<SessionView> {
  const connection = await directorConnection();

  yield* connection.session(sessionId).watch();
}

async function* emptyStream(): AsyncGenerator<SessionView> {}

/** The director's session as it streams. */
export function useDirectorSession(sessionId: SessionId | undefined) {
  const view = useQuery({
    queryKey: ["studio", "session", sessionId],
    queryFn: experimental_streamedQuery({
      streamFn: () => (sessionId === undefined ? emptyStream() : views(sessionId)),
      reducer: (_previous: SessionView | undefined, next: SessionView) => next,
      initialValue: undefined,
      refetchMode: "replace",
    }),
    enabled: sessionId !== undefined,
    retry: 3,
  });

  return { view: view.data, error: view.error };
}
