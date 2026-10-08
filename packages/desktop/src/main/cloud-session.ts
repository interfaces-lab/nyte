import { randomUUID } from "node:crypto";
import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import { sessionId } from "@nyte-ai/protocol";

export const serverRequest: typeof fetch = (input, init) => {
  if (new Headers(init?.headers).get("accept") === "text/event-stream") return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : input);
  const preparing = url.pathname.endsWith("/v1/call/sessions.create");
  // Repository preparation allows five minutes; leave time for its final reply.
  const timeout = AbortSignal.timeout(preparing ? 330_000 : 15_000);
  const signal = init?.signal == null ? timeout : AbortSignal.any([init.signal, timeout]);

  return fetch(input, { ...init, signal });
};

export async function createCloudSession(sessions: Pick<NyteClient["sessions"], "create" | "get">) {
  const id = sessionId(randomUUID());

  try {
    return await sessions.create({ sessionId: id });
  } catch (cause) {
    if (!(cause instanceof NyteTransportError) || cause.failure.kind !== "network") throw cause;

    try {
      const accepted = await sessions.get({ sessionId: id });

      if (accepted !== undefined) return accepted;
    } catch (error) {
      if (
        !(error instanceof NyteWireError) ||
        !["forbidden", "not_found", "unknown_session"].includes(error.code)
      )
        throw error;
    }

    return sessions.create({ sessionId: id });
  }
}
