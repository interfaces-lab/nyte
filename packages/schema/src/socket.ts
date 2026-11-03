import { Type } from "typebox";
import { SdkErrorWireType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import type { Id } from "./ids.ts";
import { JsonType } from "./json.ts";
import type { Decoded } from "./schema.ts";

export const SOCKET_PATH = "/.nyte/ws";

export const TICKET_PATH = "/.nyte/ws/ticket";

export const HELLO_MAX_BYTES = 4096;

export const SOCKET_LIMITS = { backlogBytes: 8_388_608, maxFrameBytes: 1_048_576 } as const;

export type ClientId = Id<"client">;

export const ClientKindType = Type.Enum(["app", "tui", "cli", "agent", "other"]);

export type ClientKind = Decoded<typeof ClientKindType>;

export const ActionDeclarationType = Type.Object({
  name: Type.String({ minLength: 1 }),
  summary: Type.String(),
  input: JsonType,
});

export type ActionDeclaration = Decoded<typeof ActionDeclarationType>;

export const ClientInfoType = Type.Object({
  kind: ClientKindType,
  name: Type.String(),
  version: Type.String(),
  actions: Type.Array(ActionDeclarationType),
});

export type ClientInfo = Decoded<typeof ClientInfoType>;

export const ClientRowType = Type.Object({
  id: idSchema<"client">(),
  principal: idSchema<"principal">(),
  kind: ClientKindType,
  name: Type.String(),
  version: Type.String(),
  actions: Type.Array(ActionDeclarationType),
  since: Type.Number(),
});

export type ClientRow = Decoded<typeof ClientRowType>;

export const HelloFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("hello"),
  api_min_revision: Type.Integer({ minimum: 1 }),
  api_revision: Type.Optional(Type.Integer({ minimum: 1 })),
  client: ClientInfoType,
});

export type HelloFrame = Decoded<typeof HelloFrameType>;

export const WelcomeFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("welcome"),
  api_revision: Type.Integer(),
  api_min_revision: Type.Integer(),
  api_server_revision: Type.Integer(),
  host_id: idSchema<"host">(),
  client_id: idSchema<"client">(),
  limits: Type.Object({ backlogBytes: Type.Integer(), maxFrameBytes: Type.Integer() }),
});

export type WelcomeFrame = Decoded<typeof WelcomeFrameType>;

export const CallFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("call"),
  id: Type.String({ minLength: 1 }),
  op: Type.String(),
  input: Type.Optional(JsonType),
});

export type CallFrame = Decoded<typeof CallFrameType>;

export const ResultFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("result"),
  id: Type.String(),
  output: JsonType,
});

export const ErrorFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("error"),
  id: Type.String(),
  error: SdkErrorWireType,
});

export const EventFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("event"),
  scope: Type.String(),
  seq: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  kind: Type.String(),
});

export type EventFrame = Decoded<typeof EventFrameType>;

export const TextFrameType = Type.Union([
  Type.Object({
    c: Type.Literal("t"),
    part: idSchema<"part">(),
    run: Type.Union([idSchema<"run">(), Type.Null()]),
    version: Type.Number(),
    text: Type.String(),
  }),
  Type.Object({
    c: Type.Literal("t"),
    part: idSchema<"part">(),
    run: Type.Union([idSchema<"run">(), Type.Null()]),
    version: Type.Number(),
    append: Type.String(),
  }),
  Type.Object({ c: Type.Literal("t"), type: Type.Literal("closed") }),
]);

export type TextFrame = Decoded<typeof TextFrameType>;

export const HostFrameType = Type.Union([
  WelcomeFrameType,
  ResultFrameType,
  ErrorFrameType,
  EventFrameType,
  TextFrameType,
]);

export type HostFrame = Decoded<typeof HostFrameType>;
