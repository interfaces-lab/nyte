import { Type } from "typebox";
import { SdkErrorWireType } from "../../errors.ts";
import { idSchema } from "../../ids.ts";
import { JsonType } from "../../json.ts";
import { ClientRowType } from "../../socket.ts";
import { NOTHING, wireObject, wireSchema } from "./fields.ts";
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
  "clients.read": {
    ...PARTICIPANT,
    summary: "Lists the clients connected to the host's WebSocket and the actions each offers.",
    kind: "query",
    input: wireObject({}),
    output: wireSchema(Type.Array(ClientRowType)),
  },
  "client.perform": {
    ...PARTICIPANT,
    summary:
      "Asks a connected client to perform an action it declared and answers what it replied.",
    kind: "command",
    input: wireObject({
      client: idSchema<"client">(),
      action: Type.String(),
      input: JsonType,
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    output: wireSchema(JsonType),
  },
  "client.reply": {
    ...PARTICIPANT,
    summary:
      "Answers an action another client asked this one to perform, with a result or an error.",
    kind: "command",
    input: wireObject({
      call: Type.String(),
      result: Type.Optional(JsonType),
      error: Type.Optional(
        Type.Object({ code: SdkErrorWireType.properties.code, message: Type.String() }),
      ),
    }),
    output: NOTHING,
  },
} as const satisfies OperationRows;
