/**
 * Wire shapes for everything a store backend reads or returns. `SqliteStore`
 * validates rows with them, and the worker bridge validates each message with
 * them, so one definition decides what a stored or transported value may be.
 * Checkers are compiled once: the interpreted checker walks the cyclic JSON
 * schema per value and is two orders of magnitude slower on a hot read path.
 */
import { canonicalJson } from "@nyte-ai/client";
import { schemas } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { hashCanonicalJson } from "./hash.ts";
import type { EventBody, Obj, Oid } from "./model.ts";
import { CorruptObject } from "./store.ts";

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const ObjectSchema = Type.Union([
  schemas.Commit,
  Type.Object({
    type: Type.Literal("change"),
    kind: Type.Union([
      Type.Literal("user"),
      Type.Literal("answer"),
      Type.Literal("passive"),
      Type.Literal("report"),
    ]),
    delivery: Type.Union([Type.Literal("steer"), Type.Literal("next")]),
    previous: NullableString,
    supersedes: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
    body: Type.Union([
      Type.Object({
        kind: Type.Literal("message"),
        message: schemas.UserMessage,
        agent: Type.Optional(Type.String()),
        source: Type.Optional(schemas.MessageSource),
      }),
      Type.Object({ kind: Type.Literal("completion"), job: schemas.JobReport }),
      Type.Object({
        kind: Type.Literal("config"),
        model: Type.Optional(schemas.ModelRef),
        thinkingLevel: Type.Optional(Type.String()),
        agent: Type.Optional(Type.String()),
      }),
    ]),
    at: Type.Number(),
    author: Type.Optional(schemas.Actor),
  }),
  Type.Object({
    kind: Type.Literal("run"),
    id: Type.String(),
    head: Type.String(),
    origin: schemas.RunOrigin,
    root: Type.String(),
    phase: schemas.RunPhase,
    startedAt: Type.Number(),
    attempts: Type.Number(),
    config: Type.Object({
      model: Type.Optional(schemas.ModelRef),
      thinkingLevel: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
    }),
    abortRequested: Type.Optional(Type.Literal(true)),
  }),
  Type.Object({
    kind: Type.Literal("effect"),
    state: Type.Literal("intent"),
    runId: Type.String(),
    callId: Type.String(),
    tool: Type.String(),
    args: schemas.JsonValue,
    replay: Type.Union([Type.Literal("safe"), Type.Literal("never")]),
    at: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("effect"),
    state: Type.Literal("waiting"),
    intent: Type.String(),
    at: Type.Number(),
    selection: Type.Optional(schemas.Selection),
    until: Type.Optional(Type.Number()),
  }),
  Type.Object({
    kind: Type.Literal("effect"),
    state: Type.Literal("expired"),
    intent: Type.String(),
    at: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("effect"),
    state: Type.Literal("signal"),
    intent: Type.String(),
    signal: schemas.JsonValue,
    at: Type.Number(),
    author: Type.Optional(schemas.Actor),
  }),
  Type.Object({
    kind: Type.Literal("effect"),
    state: Type.Literal("result"),
    intent: Type.String(),
    result: schemas.ToolResultMessage,
    at: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("stack"), parent: Type.String(), base: NullableString }),
  Type.Object({ kind: Type.Literal("blob"), value: schemas.JsonValue }),
]);

export const EventBodySchema = Type.Union([
  Type.Object({
    kind: Type.Literal("ref"),
    name: Type.String(),
    from: NullableString,
    to: NullableString,
    reason: Type.String(),
    actor: Type.Optional(schemas.Actor),
  }),
  Type.Object({
    kind: Type.Literal("delta"),
    runId: Type.String(),
    attempt: Type.Number(),
    index: Type.Number(),
    part: Type.Union([Type.Literal("text"), Type.Literal("thinking")]),
    delta: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal("progress"),
    runId: Type.String(),
    callId: Type.String(),
    progress: schemas.ToolProgress,
  }),
  Type.Object({
    kind: Type.Literal("notice"),
    level: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]),
    owner: Type.String(),
    message: Type.String(),
  }),
]);

export const EventSchema = Type.Intersect([
  EventBodySchema,
  Type.Object({ seq: Type.Number(), at: Type.Number() }),
]);

export const LeaseSchema = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  fence: Type.Number(),
  expiresAt: Type.Number(),
});

export const RefUpdateSchema = Type.Object({
  name: Type.String(),
  from: NullableString,
  to: NullableString,
});

export const RefUpdateOutcomeSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), seq: Type.Number() }),
  Type.Object({
    ok: Type.Literal(false),
    reason: Type.Literal("conflict"),
    name: Type.String(),
    actual: NullableString,
  }),
  Type.Object({ ok: Type.Literal(false), reason: Type.Literal("fenced") }),
]);

export const LeaseOutcomeSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), lease: LeaseSchema }),
  Type.Object({ ok: Type.Literal(false), holder: LeaseSchema }),
]);

export const AppendOutcomeSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), seq: Type.Number() }),
  Type.Object({ ok: Type.Literal(false), reason: Type.Literal("fenced") }),
]);

export const StoreSessionInfoSchema = Type.Object({ id: Type.String(), createdAt: Type.Number() });

export const checkObject = Compile(ObjectSchema);
export const checkEventBody = Compile(EventBodySchema);

export function parseStoredObject(body: string, oid: Oid) {
  const value: unknown = JSON.parse(body);

  if (!checkObject.Check(value)) throw new CorruptObject(oid, "is not a known object");

  if (hashCanonicalJson(body) !== oid) throw new CorruptObject(oid, "does not match its hash");

  return value;
}

export function serializeObject(object: Obj) {
  const body = canonicalJson(object);
  const value: unknown = JSON.parse(body);
  if (!checkObject.Check(value)) {
    throw new TypeError("Object is not valid after JSON serialization");
  }
  return { body, kind: value.kind, oid: hashCanonicalJson(body) };
}

export function serializeEventBody(body: EventBody): string {
  const serialized = JSON.stringify(body);
  if (serialized === undefined) throw new TypeError("Event body is not JSON serializable");
  const value: unknown = JSON.parse(serialized);
  if (!checkEventBody.Check(value)) {
    throw new TypeError("Event body is not valid after JSON serialization");
  }
  return serialized;
}
