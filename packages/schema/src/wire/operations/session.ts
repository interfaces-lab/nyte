import { Type } from "typebox";
import { ConfigurationPatchType } from "../configuration.ts";
import { ValidationIssueType } from "../errors.ts";
import { PatchEventType, SessionEventType } from "../events.ts";
import {
  ConfigureOutcomeSchema,
  CreateHeadOutcomeSchema,
  MergeOutcomeSchema,
  MoveOptionsType,
  MoveOutcomeType,
  RemoveHeadOutcomeSchema,
  SendOptionsType,
  TreeViewSchema,
} from "../heads.ts";
import { idSchema, SeqType } from "../ids.ts";
import { JsonType, JsonValueSchema } from "../json.ts";
import { PositionType, UserContentType } from "../messages.ts";
import { nullable } from "../nullable.ts";
import { actOutcomeSchema, PlacementType } from "../parts.ts";
import { RunEndSchema, RunEndType, stopOutcomeSchema } from "../runs.ts";
import {
  CommandOutcomeSchema,
  RemoveSessionOutcomeSchema,
  SessionInfoSchema,
  UpdateOutcomeSchema,
} from "../sessions.ts";
import { MessageType, SessionViewSchema, UserStatusType, ViewOptionsType } from "../views.ts";
import { NOTHING, ON_SESSION, RECEIPT_ID, SESSION, wireObject, wireSchema } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "session" } as const;

const [, , LANDED] = UserStatusType.anyOf;

const [, ...MOVE_FAILURES] = MoveOutcomeType.anyOf;

const HEAD = { ...SESSION, head: idSchema<"head">() };

const PART = { ...SESSION, part: idSchema<"part">() };

const NAMED_HEAD = { ...SESSION, name: idSchema<"head">() };

const ON_RUN = wireObject({ ...SESSION, run: idSchema<"run">() });

const ON_RECEIPT = wireObject({
  session: nullable(idSchema<"session">()),
  receipt: idSchema<"receipt">(),
});

const ON_PART = wireObject(PART);

const NAMED_HEAD_INPUT = wireObject({
  ...NAMED_HEAD,
  options: Type.Optional(Type.Object({ expect: Type.Optional(idSchema<"revision">()) })),
});

export const SESSION_OPERATIONS = {
  "session.info": { ...PARTICIPANT, kind: "query", input: ON_SESSION, output: SessionInfoSchema },
  "session.update": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...SESSION,
      patch: Type.Object({
        name: Type.Optional(nullable(Type.String())),
        pinned: Type.Optional(Type.Boolean()),
        archived: Type.Optional(Type.Boolean()),
        workspace: Type.Optional(idSchema<"workspace">()),
      }),
    }),
    output: UpdateOutcomeSchema,
  },
  "session.remove": {
    ...PARTICIPANT,
    kind: "command",
    input: ON_SESSION,
    output: RemoveSessionOutcomeSchema,
  },
  "session.stop": {
    ...PARTICIPANT,
    kind: "command",
    input: ON_SESSION,
    output: wireObject({
      stopped: Type.Array(idSchema<"run">()),
      withdrawn: Type.Array(idSchema<"message">()),
    }),
  },
  "session.command": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...SESSION,
      name: Type.String(),
      args: Type.Optional(JsonType),
    }),
    output: CommandOutcomeSchema,
  },
  "head.send": {
    ...PARTICIPANT,
    kind: "receipt",
    recovery: "replay",
    input: wireObject({
      ...HEAD,
      content: UserContentType,
      options: Type.Optional(SendOptionsType),
    }),
    output: wireObject({
      receipt: idSchema<"receipt">(),
      message: idSchema<"message">(),
    }),
  },
  "head.configure": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({ ...HEAD, patch: ConfigurationPatchType }),
    output: ConfigureOutcomeSchema,
  },
  "head.view": {
    ...PARTICIPANT,
    kind: "query",
    input: wireObject({ ...HEAD, options: Type.Optional(ViewOptionsType) }),
    output: SessionViewSchema,
  },
  "head.watch": {
    ...PARTICIPANT,
    kind: "watch",
    input: wireObject({
      ...HEAD,
      options: Type.Optional(ViewOptionsType),
      after: Type.Optional(SeqType),
    }),
    output: wireSchema(
      Type.Union([
        SessionEventType,
        PatchEventType,
        Type.Object({
          kind: Type.Literal("revision"),
          head: idSchema<"head">(),
          tip: nullable(idSchema<"commit">()),
          revision: idSchema<"revision">(),
        }),
      ]),
    ),
  },
  "head.history": {
    ...PARTICIPANT,
    kind: "query",
    input: wireObject({
      ...HEAD,
      before: idSchema<"message">(),
      limit: Type.Number(),
    }),
    output: wireSchema(Type.Array(MessageType)),
  },
  "head.tree": { ...PARTICIPANT, kind: "query", input: wireObject(HEAD), output: TreeViewSchema },
  "head.move": {
    ...PARTICIPANT,
    kind: "receipt",
    recovery: "replay",
    input: wireObject({
      ...HEAD,
      position: PositionType,
      options: Type.Optional(MoveOptionsType),
      id: Type.Optional(idSchema<"receipt">()),
    }),
    output: RECEIPT_ID,
  },
  "head.compact": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...HEAD,
      instructions: Type.Optional(Type.String()),
    }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("started"), message: idSchema<"message">() }),
        Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
        Type.Object({ kind: Type.Literal("nothing-to-compact") }),
      ]),
    ),
  },
  "heads.create": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...NAMED_HEAD,
      input: Type.Optional(Type.Object({ from: Type.Optional(PositionType) })),
    }),
    output: CreateHeadOutcomeSchema,
  },
  "heads.merge": {
    ...PARTICIPANT,
    kind: "command",
    input: NAMED_HEAD_INPUT,
    output: MergeOutcomeSchema,
  },
  "heads.remove": {
    ...PARTICIPANT,
    kind: "command",
    input: NAMED_HEAD_INPUT,
    output: RemoveHeadOutcomeSchema,
  },
  "run.stop": {
    ...PARTICIPANT,
    kind: "command",
    input: ON_RUN,
    output: stopOutcomeSchema(RunEndType),
  },
  "run.settled": { ...PARTICIPANT, kind: "query", wait: true, input: ON_RUN, output: RunEndSchema },
  "receipt.status": {
    ...PARTICIPANT,
    kind: "query",
    input: ON_RECEIPT,
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("pending") }),
        Type.Object({ kind: Type.Literal("settled"), outcome: JsonType }),
        Type.Object({ kind: Type.Literal("missing") }),
      ]),
    ),
  },
  "receipt.settled": {
    ...PARTICIPANT,
    kind: "query",
    wait: true,
    input: ON_RECEIPT,
    output: JsonValueSchema,
  },
  "receipt.stop": {
    ...PARTICIPANT,
    kind: "command",
    input: ON_RECEIPT,
    output: stopOutcomeSchema(JsonType),
  },
  "receipt.landed": {
    ...PARTICIPANT,
    kind: "query",
    wait: true,
    input: ON_RECEIPT,
    output: wireSchema(
      Type.Union([LANDED, Type.Object({ kind: Type.Literal("withdrawn") }), ...MOVE_FAILURES]),
    ),
  },
  "parts.create": {
    ...PARTICIPANT,
    kind: "command",
    recovery: "replay",
    input: wireObject({
      ...SESSION,
      kind: Type.String(),
      input: Type.Object({
        state: JsonType,
        placement: PlacementType,
        id: Type.Optional(idSchema<"part">()),
      }),
    }),
    output: wireObject({ part: idSchema<"part">() }),
  },
  "part.update": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...PART,
      next: JsonType,
      options: Type.Optional(Type.Object({ version: Type.Optional(Type.Number()) })),
    }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("updated"), version: Type.Number() }),
        Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
        Type.Object({ kind: Type.Literal("closed") }),
        Type.Object({ kind: Type.Literal("missing") }),
        Type.Object({ kind: Type.Literal("stale") }),
      ]),
    ),
  },
  "part.act": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({ ...PART, action: Type.String(), input: JsonType }),
    output: actOutcomeSchema(JsonType),
  },
  "part.answer": {
    ...PARTICIPANT,
    kind: "query",
    wait: true,
    input: ON_PART,
    output: wireSchema(nullable(Type.Object({ action: Type.String(), input: JsonType }))),
  },
  "part.close": { ...PARTICIPANT, kind: "command", input: ON_PART, output: NOTHING },
} as const satisfies OperationRows;
