import { Type } from "typebox";
import { NOTHING, wireObject } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "host" } as const;

const SCOPES = wireObject({
  scopes: Type.Array(Type.String({ pattern: "^(host|session/[^/]+|client/[^/]+)$" })),
});

export const EVENT_OPERATIONS = {
  "events.subscribe": {
    ...PARTICIPANT,
    summary:
      "Sends the connection every later event of the scopes named, on the socket's event channel.",
    kind: "command",
    input: SCOPES,
    output: NOTHING,
  },
  "events.unsubscribe": {
    ...PARTICIPANT,
    summary: "Stops sending the connection the events of the scopes named.",
    kind: "command",
    input: SCOPES,
    output: NOTHING,
  },
  "text.open": {
    ...PARTICIPANT,
    summary:
      "Opens the socket's text channel: the whole text of every part streaming in the subscribed sessions, then what each streams.",
    kind: "command",
    input: wireObject({}),
    output: NOTHING,
  },
} as const satisfies OperationRows;
