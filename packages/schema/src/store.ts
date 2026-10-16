import { Type } from "typebox";
import { DurableEventType } from "./events.ts";
import { idSchema, SeqType } from "./ids.ts";
import { withJson } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const RefType = Type.Object({
  name: Type.String(),
  target: nullable(idSchema<"object">()),
  revision: idSchema<"revision">(),
});

export type Ref = Decoded<typeof RefType>;

export const RefUpdateType = Type.Object({
  name: Type.String(),
  target: nullable(idSchema<"object">()),
  expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"revision">()])),
  events: Type.Optional(Type.Array(DurableEventType)),
});

export type RefUpdate = Decoded<typeof RefUpdateType>;

export const SetOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("set"),
    logged: Type.Array(SeqType),
    at: Type.Number(),
    revisions: Type.Array(idSchema<"revision">()),
  }),
  Type.Object({
    kind: Type.Literal("stale"),
    name: Type.String(),
    revision: nullable(idSchema<"revision">()),
  }),
]);

/** What `RefStore.set` did: `set` with the seq each event was logged at, in update order and each update's events in order, the time it logged them at, and each update's new revision; or `stale`, naming the first ref whose expectation failed. */
export type SetOutcome = Decoded<typeof SetOutcomeType>;

export const RefSchema: Schema<Ref> = standard(RefType);

export const RefUpdateSchema: Schema<RefUpdate> = standard(withJson(RefUpdateType));

export const SetOutcomeSchema: Schema<SetOutcome> = standard(SetOutcomeType);
