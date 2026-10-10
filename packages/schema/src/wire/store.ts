import { Type } from "typebox";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type { Ref, RefUpdate, SetOutcome } from "../store.ts";
import { DurableEventType } from "./events.ts";
import { SeqType, idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `Ref`. */
export const RefType = Type.Object({
  name: Type.String(),
  target: nullable(idSchema<"object">()),
  revision: idSchema<"revision">(),
});

/** The TypeBox schema of a `RefUpdate`. */
export const RefUpdateType = Type.Object({
  name: Type.String(),
  target: nullable(idSchema<"object">()),
  expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"revision">()])),
  event: Type.Optional(DurableEventType),
});

/** The TypeBox schema of a `SetOutcome`. */
export const SetOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("set"),
    seq: SeqType,
    revisions: Type.Array(idSchema<"revision">()),
  }),
  Type.Object({
    kind: Type.Literal("stale"),
    name: Type.String(),
    revision: nullable(idSchema<"revision">()),
  }),
]);

/** Validates a `Ref`. */
export const RefSchema: Schema<Ref> = standard(RefType);

/** Validates a `RefUpdate`. */
export const RefUpdateSchema: Schema<RefUpdate> = standard(withJson(RefUpdateType));

/** Validates a `SetOutcome`. */
export const SetOutcomeSchema: Schema<SetOutcome> = standard(SetOutcomeType);
