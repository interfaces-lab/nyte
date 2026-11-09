import { Type } from "typebox";
import { ConfigurationPatchType } from "../../configuration.ts";
import { ValidationIssueType } from "../../errors.ts";
import {
  ConfigureOutcomeSchema,
  CreateHeadOutcomeSchema,
  HoldLeaseType,
  MergeOutcomeSchema,
  MoveOptionsType,
  MoveOutcomeType,
  RemoveHeadOutcomeSchema,
  ReviseOptionsType,
  ReviseOutcomeType,
  SendOptionsType,
  TreeViewSchema,
} from "../../heads.ts";
import { idSchema } from "../../ids.ts";
import { JsonType, JsonValueSchema } from "../../json.ts";
import { PositionType, UserContentType } from "../../messages.ts";
import { nullable } from "../nullable.ts";
import { actOutcomeSchema, PlacementType } from "../../parts.ts";
import { RunEndSchema, RunEndType, stopOutcomeSchema } from "../../runs.ts";
import {
  CommandCompletionsSchema,
  CommandOutcomeSchema,
  ForkOutcomeSchema,
  RemoveSessionOutcomeSchema,
  SessionInfoSchema,
  UpdateOutcomeSchema,
} from "../../sessions.ts";
import {
  HeadWindowType,
  HistoryPageType,
  PartReadType,
  ResumeType,
  SessionViewSchema,
  UserStatusType,
  ViewOptionsType,
  WindowSpecType,
} from "../../views.ts";
import { NOTHING, ON_SESSION, RECEIPT_ID, SESSION, wireObject, wireSchema } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "session" } as const;

const [, , LANDED] = UserStatusType.anyOf;

const [, ...MOVE_FAILURES] = MoveOutcomeType.anyOf;

const HEAD = { ...SESSION, head: idSchema<"head">() };

const PART = { ...SESSION, part: idSchema<"part">() };

const NAMED_HEAD = { ...SESSION, name: idSchema<"head">() };

const ON_MESSAGE = wireObject({ ...HEAD, message: idSchema<"message">() });

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
  "session.info": {
    ...PARTICIPANT,
    mcp: "read",
    summary: "Reads a session's name, state and other details.",
    kind: "query",
    input: ON_SESSION,
    output: SessionInfoSchema,
  },
  "session.update": {
    ...PARTICIPANT,
    summary: "Renames, pins, archives or moves a session to another workspace.",
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
  "session.fork": {
    ...PARTICIPANT,
    summary: "Starts a new chat with a session's history up to a commit, by default its latest.",
    kind: "command",
    input: wireObject({ ...SESSION, from: Type.Optional(idSchema<"commit">()) }),
    output: ForkOutcomeSchema,
  },
  "session.remove": {
    ...PARTICIPANT,
    summary: "Deletes a session.",
    kind: "command",
    input: ON_SESSION,
    output: RemoveSessionOutcomeSchema,
  },
  "session.stop": {
    ...PARTICIPANT,
    mcp: "write",
    summary: "Stops every run in a session and withdraws its queued messages.",
    kind: "command",
    input: ON_SESSION,
    output: wireObject({
      stopped: Type.Array(idSchema<"run">()),
      withdrawn: Type.Array(idSchema<"message">()),
    }),
  },
  "session.command": {
    ...PARTICIPANT,
    summary: "Runs a plugin command in a session with the text typed after it.",
    kind: "command",
    input: wireObject({
      ...SESSION,
      name: Type.String(),
      text: Type.String(),
    }),
    output: CommandOutcomeSchema,
  },
  "session.completeCommand": {
    ...PARTICIPANT,
    summary: "Returns suggestions for the text after a plugin command.",
    kind: "query",
    input: wireObject({ ...SESSION, name: Type.String(), prefix: Type.String() }),
    output: CommandCompletionsSchema,
  },
  "head.send": {
    ...PARTICIPANT,
    mcp: "write",
    summary: "Sends a message to a head and returns its receipt.",
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
    summary: "Changes a head's model, thinking level or other settings.",
    kind: "command",
    input: wireObject({ ...HEAD, patch: ConfigurationPatchType }),
    output: ConfigureOutcomeSchema,
  },
  "head.view": {
    ...PARTICIPANT,
    mcp: "read",
    summary: "Reads the current transcript and state of a head.",
    kind: "query",
    input: wireObject({ ...HEAD, options: Type.Optional(ViewOptionsType) }),
    output: SessionViewSchema,
  },
  "head.read": {
    ...PARTICIPANT,
    summary:
      "Reads a window of a head's rows at a seq, or what changed in it since a seq the client resumes from.",
    kind: "query",
    input: wireObject({
      ...HEAD,
      window: WindowSpecType,
      resume: Type.Optional(ResumeType),
    }),
    output: wireSchema(HeadWindowType),
  },
  "head.see": {
    ...PARTICIPANT,
    summary: "Marks a head as seen up to a commit.",
    kind: "command",
    input: wireObject({ ...HEAD, commit: idSchema<"commit">() }),
    output: NOTHING,
  },
  "head.history": {
    ...PARTICIPANT,
    mcp: "read",
    summary: "Returns older messages before a given message, with their turns.",
    kind: "query",
    input: wireObject({
      ...HEAD,
      before: idSchema<"message">(),
      limit: Type.Number(),
    }),
    output: wireSchema(HistoryPageType),
  },
  "head.tree": {
    ...PARTICIPANT,
    summary: "Returns the tree of messages and branches behind a head.",
    kind: "query",
    input: wireObject(HEAD),
    output: TreeViewSchema,
  },
  "head.move": {
    ...PARTICIPANT,
    summary: "Moves a head to an earlier or other position in the chat.",
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
    summary: "Starts summarizing a head's transcript to free up context.",
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
  "head.revise": {
    ...PARTICIPANT,
    mcp: "write",
    summary: "Edits the content of a message that has not been sent yet.",
    kind: "command",
    input: wireObject({
      ...HEAD,
      message: idSchema<"message">(),
      content: UserContentType,
      options: Type.Optional(ReviseOptionsType),
    }),
    output: wireSchema(ReviseOutcomeType),
  },
  "head.hold": {
    ...PARTICIPANT,
    summary: "Holds a queued message so it is not sent while it is being edited.",
    kind: "command",
    input: ON_MESSAGE,
    output: wireSchema(HoldLeaseType),
  },
  "head.release": {
    ...PARTICIPANT,
    summary: "Releases a held message so it can be sent.",
    kind: "command",
    input: ON_MESSAGE,
    output: NOTHING,
  },
  "heads.create": {
    ...PARTICIPANT,
    summary: "Creates a named head, optionally from a given position.",
    kind: "command",
    input: wireObject({
      ...NAMED_HEAD,
      input: Type.Optional(Type.Object({ from: Type.Optional(PositionType) })),
    }),
    output: CreateHeadOutcomeSchema,
  },
  "heads.merge": {
    ...PARTICIPANT,
    summary: "Merges a named head into main.",
    kind: "command",
    input: NAMED_HEAD_INPUT,
    output: MergeOutcomeSchema,
  },
  "heads.remove": {
    ...PARTICIPANT,
    summary: "Deletes a named head.",
    kind: "command",
    input: NAMED_HEAD_INPUT,
    output: RemoveHeadOutcomeSchema,
  },
  "run.stop": {
    ...PARTICIPANT,
    summary: "Stops a run.",
    kind: "command",
    input: ON_RUN,
    output: stopOutcomeSchema(RunEndType),
  },
  "run.settled": {
    ...PARTICIPANT,
    summary: "Waits until a run ends and returns how it ended.",
    kind: "query",
    wait: true,
    input: ON_RUN,
    output: RunEndSchema,
  },
  "receipt.status": {
    ...PARTICIPANT,
    summary: "Checks whether a receipt is pending, settled or missing.",
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
    summary: "Waits until a receipt settles and returns its outcome.",
    kind: "query",
    wait: true,
    input: ON_RECEIPT,
    output: JsonValueSchema,
  },
  "receipt.stop": {
    ...PARTICIPANT,
    summary: "Stops the work behind a receipt.",
    kind: "command",
    input: ON_RECEIPT,
    output: stopOutcomeSchema(JsonType),
  },
  "receipt.landed": {
    ...PARTICIPANT,
    summary: "Waits until a sent message lands or fails and returns where it landed.",
    kind: "query",
    wait: true,
    input: ON_RECEIPT,
    output: wireSchema(
      Type.Union([LANDED, Type.Object({ kind: Type.Literal("withdrawn") }), ...MOVE_FAILURES]),
    ),
  },
  "parts.create": {
    ...PARTICIPANT,
    summary: "Creates a part in a session with its initial state and placement.",
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
  "part.read": {
    ...PARTICIPANT,
    summary:
      "Reads one part wherever it sits in its session, at a seq the session's changes continue from.",
    kind: "query",
    input: wireObject(PART),
    output: wireSchema(PartReadType),
  },
  "part.update": {
    ...PARTICIPANT,
    summary: "Replaces a part's state.",
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
    summary: "Performs one of a part's actions with the given input.",
    kind: "command",
    input: wireObject({ ...PART, action: Type.String(), input: JsonType }),
    output: actOutcomeSchema(JsonType),
  },
  "part.answer": {
    ...PARTICIPANT,
    summary: "Waits until a part is answered and returns the action that answered it.",
    kind: "query",
    wait: true,
    input: ON_PART,
    output: wireSchema(nullable(Type.Object({ action: Type.String(), input: JsonType }))),
  },
  "part.close": {
    ...PARTICIPANT,
    summary: "Closes a part.",
    kind: "command",
    input: ON_PART,
    output: NOTHING,
  },
} as const satisfies OperationRows;
