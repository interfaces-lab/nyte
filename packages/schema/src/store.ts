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
  fence: Type.Optional(Type.String()),
});

/** One ref a `RefStore.set` writes: its new target (null deletes it), the revision it must be at (`absent`: it must not exist), the events it logs to its session in order, and `fence`, a ref that must exist for the set to land (a run's live ref, which its stop deletes). */
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
  Type.Object({ kind: Type.Literal("fenced"), name: Type.String() }),
]);

/** What `RefStore.set` did: `set` with the seq each event was logged at, in update order and each update's events in order, the time it logged them at, and each update's new revision; `fenced`, naming the first fence ref an update needed that does not exist, checked before any expectation; or `stale`, naming the first ref whose expectation failed. A set that is not `set` wrote nothing. */
export type SetOutcome = Decoded<typeof SetOutcomeType>;

export const RefSchema: Schema<Ref> = standard(RefType);

export const RefUpdateSchema: Schema<RefUpdate> = standard(withJson(RefUpdateType));

export const SetOutcomeSchema: Schema<SetOutcome> = standard(SetOutcomeType);
