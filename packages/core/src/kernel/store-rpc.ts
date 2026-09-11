/**
 * Messages between `WorkerStore` and `store-worker`. Sessions cross the bridge
 * as numeric handles because the SDK may open the same id twice and close the
 * loser; a handle names one opened `Session`, never the session id.
 */
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { EventSchema } from "./store-schemas.ts";

const StoreMethodSchema = Type.Union([
  Type.Literal("store.create"),
  Type.Literal("store.open"),
  Type.Literal("store.list"),
  Type.Literal("store.delete"),
  Type.Literal("store.close"),
  Type.Literal("session.close"),
  Type.Literal("objects.put"),
  Type.Literal("objects.get"),
  Type.Literal("objects.chain"),
  Type.Literal("objects.list"),
  Type.Literal("objects.commits"),
  Type.Literal("objects.delete"),
  Type.Literal("refs.read"),
  Type.Literal("refs.list"),
  Type.Literal("refs.update"),
  Type.Literal("leases.acquire"),
  Type.Literal("leases.renew"),
  Type.Literal("leases.release"),
  Type.Literal("leases.read"),
  Type.Literal("events.append"),
  Type.Literal("events.read"),
  Type.Literal("events.last"),
  Type.Literal("events.floor"),
  Type.Literal("events.trim"),
]);
export type StoreMethod = Static<typeof StoreMethodSchema>;

const RequestSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("call"),
    id: Type.Number(),
    session: Type.Union([Type.Number(), Type.Null()]),
    method: StoreMethodSchema,
    args: Type.Array(Type.Unknown()),
  }),
  Type.Object({
    kind: Type.Literal("watch"),
    id: Type.Number(),
    session: Type.Number(),
    afterSeq: Type.Number(),
    /** How many events the consumer will take before granting more. */
    credit: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("credit"), id: Type.Number(), credit: Type.Number() }),
  Type.Object({ kind: Type.Literal("unwatch"), id: Type.Number() }),
]);
export type StoreRequest = Static<typeof RequestSchema>;

const WireErrorSchema = Type.Object({
  name: Type.String(),
  message: Type.String(),
  /** `UnknownSession` carries the id; `CursorExpired` carries the floor. */
  id: Type.Optional(Type.String()),
  floor: Type.Optional(Type.Number()),
});
export type WireError = Static<typeof WireErrorSchema>;

const ResponseSchema = Type.Union([
  Type.Object({ kind: Type.Literal("ready") }),
  Type.Object({ kind: Type.Literal("ok"), id: Type.Number(), value: Type.Unknown() }),
  Type.Object({ kind: Type.Literal("error"), id: Type.Number(), error: WireErrorSchema }),
  /** Events the store yielded in one tick, so a consumer folds them without a task boundary between. */
  Type.Object({ kind: Type.Literal("events"), id: Type.Number(), events: Type.Array(EventSchema) }),
  Type.Object({ kind: Type.Literal("end"), id: Type.Number() }),
]);
export type StoreResponse = Static<typeof ResponseSchema>;

export const checkRequest = Compile(RequestSchema);
export const checkResponse = Compile(ResponseSchema);

/** A handle plus the id it opened, so the client can name the session without a round trip. */
export const SessionHandleSchema = Type.Object({ handle: Type.Number(), id: Type.String() });
