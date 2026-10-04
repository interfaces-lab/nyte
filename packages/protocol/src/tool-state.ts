import { Type } from "typebox";
import type { Static, TProperties } from "typebox";
import { open } from "./schema-helpers.ts";

/** An output variant a client may read without copying: the named keys, extra keys tolerated. */
const variant = <P extends TProperties>(properties: P) => Type.ReadonlyObject(open(properties));

const absent = Type.Optional(Type.Never());

const Oid = Type.String({ minLength: 1 });

const NonZeroInteger = Type.Union([Type.Integer({ maximum: -1 }), Type.Integer({ minimum: 1 })]);

/** `interrupted` is completion unknown: the run left the call behind. `cancelled` is a participant's stop. */
export const ToolReason = Type.Union([
  variant({ kind: Type.Literal("exit"), code: NonZeroInteger }),
  variant({
    kind: Type.Union([
      Type.Literal("error"),
      Type.Literal("timeout"),
      Type.Literal("denied"),
      Type.Literal("cancelled"),
      Type.Literal("interrupted"),
    ]),
    code: absent,
  }),
]);

export type ToolReason = Static<typeof ToolReason>;

const success = { kind: Type.Literal("success"), reason: absent };

const error = { kind: Type.Literal("error"), reason: ToolReason };

export const ToolOutcome = Type.Union([variant(success), variant(error)]);

export type ToolOutcome = Static<typeof ToolOutcome>;

/** The result commit once it landed; null for a call settled without one, such as an interrupted call. */
const settled = { commit: Type.Union([Oid, Type.Null()]), waitingFor: absent };

/** `waitingFor` is set only while an authoritative ask parks the call on a participant's reply. */
export const ToolState = Type.Union([
  variant({ kind: Type.Literal("pending"), waitingFor: absent, commit: absent, reason: absent }),
  variant({
    kind: Type.Literal("running"),
    waitingFor: Type.Optional(variant({ kind: Type.Literal("input"), waitId: Oid })),
    commit: absent,
    reason: absent,
  }),
  variant({ ...success, ...settled }),
  variant({ ...error, ...settled }),
]);

export type ToolState = Static<typeof ToolState>;
