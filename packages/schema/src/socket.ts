import { Type } from "typebox";
import { SdkErrorWireType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import type { Id } from "./ids.ts";
import { JsonType } from "./json.ts";
import type { Decoded } from "./schema.ts";
import { ToolProgressType } from "./tools.ts";

export const SOCKET_PATH = "/.nyte/ws";

export const TICKET_PATH = "/.nyte/ws/ticket";

/** The most a hello frame holds: a client's name and every action it declares, each with its input schema. */
export const HELLO_MAX_BYTES = 65_536;

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

/** `operations` is the client build's operations digest, which tells two builds of one version apart. */
export const HelloFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("hello"),
  api_min_revision: Type.Integer({ minimum: 1 }),
  api_revision: Type.Integer({ minimum: 1 }),
  operations: Type.String(),
  client: ClientInfoType,
});

export type HelloFrame = Decoded<typeof HelloFrameType>;

/**
 * How the host's build compares with the client's that said hello. An older host says who may
 * replace it: it retires itself `when-idle` for a newer client of its own supervisor, a person
 * restarts it (`manual`), or this client can't (`none`).
 */
export const BuildMatchType = Type.Union([
  Type.Object({ kind: Type.Literal("current") }),
  Type.Object({
    kind: Type.Literal("host-older"),
    replace: Type.Enum(["when-idle", "manual", "none"]),
  }),
  Type.Object({ kind: Type.Literal("host-newer") }),
]);

export type BuildMatch = Decoded<typeof BuildMatchType>;

export const WelcomeFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("welcome"),
  api_revision: Type.Integer(),
  api_min_revision: Type.Integer(),
  api_server_revision: Type.Integer(),
  host_id: idSchema<"host">(),
  client_id: idSchema<"client">(),
  version: Type.String(),
  startedAt: Type.Number(),
  match: BuildMatchType,
  limits: Type.Object({ backlogBytes: Type.Integer(), maxFrameBytes: Type.Integer() }),
});

export type WelcomeFrame = Decoded<typeof WelcomeFrameType>;

/** The host's answer to a hello outside the revisions it serves, before it closes the socket: which side must update. */
export const RefusedFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("refused"),
  reason: Type.Enum(["update-host", "update-client"]),
  message: Type.String(),
});

export type RefusedFrame = Decoded<typeof RefusedFrameType>;

export const ClosingReasonType = Type.Enum(["replacing", "restarting", "stopping"]);

export type ClosingReason = Decoded<typeof ClosingReasonType>;

/** What the host pushes to every socket before it closes them with 1001. */
export const ClosingEventType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("event"),
  scope: Type.Literal("host"),
  seq: Type.Null(),
  kind: Type.Literal("closing"),
  reason: ClosingReasonType,
});

export type ClosingEvent = Decoded<typeof ClosingEventType>;

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

export const FragmentFrameType = Type.Object({
  c: Type.Literal("e"),
  type: Type.Literal("fragment"),
  text: Type.String(),
  last: Type.Boolean(),
});

export type FragmentFrame = Decoded<typeof FragmentFrameType>;

export const PerformEventType = Type.Object({
  scope: Type.String(),
  seq: Type.Integer({ minimum: 1 }),
  kind: Type.Literal("perform"),
  call: Type.String(),
  requester: Type.Object({ client: idSchema<"client">(), principal: idSchema<"principal">() }),
  action: Type.String(),
  input: JsonType,
});

export type PerformEvent = Decoded<typeof PerformEventType>;

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
  Type.Object({
    c: Type.Literal("t"),
    part: idSchema<"part">(),
    run: Type.Union([idSchema<"run">(), Type.Null()]),
    progress: ToolProgressType,
  }),
  Type.Object({ c: Type.Literal("t"), type: Type.Literal("closed") }),
]);

export type TextFrame = Decoded<typeof TextFrameType>;

export const HostFrameType = Type.Union([
  WelcomeFrameType,
  RefusedFrameType,
  ResultFrameType,
  ErrorFrameType,
  EventFrameType,
  FragmentFrameType,
  TextFrameType,
]);

export type HostFrame = Decoded<typeof HostFrameType>;
