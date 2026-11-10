import { OPERATIONS } from "../../../src/index.ts";
import { operation, session, principal } from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const eventOperations = {
  "events.subscribe input": operation(
    OPERATIONS["events.subscribe"].input,
    { scopes: ["host", "session/s1", "client/c1"] },
    { scopes: ["sessions"] },
  ),
  "events.subscribe output": operation(OPERATIONS["events.subscribe"].output, null, {}),
  "events.unsubscribe input": operation(
    OPERATIONS["events.unsubscribe"].input,
    { scopes: ["session/s1"] },
    { scopes: "session/s1" },
  ),
  "events.unsubscribe output": operation(OPERATIONS["events.unsubscribe"].output, null, {}),
  "text.open input": operation(OPERATIONS["text.open"].input, {}, null),
  "text.open output": operation(OPERATIONS["text.open"].output, null, {}),
  "clients.read input": operation(OPERATIONS["clients.read"].input, {}, null),
  "clients.read output": operation(
    OPERATIONS["clients.read"].output,
    [
      {
        id: "c1",
        principal,
        kind: "app",
        name: "Nyte",
        version: "0.1.0",
        actions: [{ name: "open", summary: "Opens a session.", input: { type: "object" } }],
        since: 1,
      },
    ],
    [{ id: "c1", principal, kind: "phone", name: "Nyte", version: "0.1.0", actions: [], since: 1 }],
  ),
  "client.perform input": operation(
    OPERATIONS["client.perform"].input,
    { client: "c1", action: "open", input: { session }, timeoutMs: 5_000 },
    { client: "c1", action: "open", input: {}, timeoutMs: 0 },
  ),
  "client.perform output": operation(
    OPERATIONS["client.perform"].output,
    { opened: true },
    undefined,
  ),
  "client.reply input": operation(
    OPERATIONS["client.reply"].input,
    { call: "k1", error: { code: "not_supported", message: "No." } },
    { call: "k1", error: { code: "nope", message: "No." } },
  ),
  "client.reply output": operation(OPERATIONS["client.reply"].output, null, {}),
} satisfies Record<string, Case>;
