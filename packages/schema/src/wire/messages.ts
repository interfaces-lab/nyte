import { Type } from "typebox";
import type { Delivery, MessageSource, Position, Schedule, UserContent } from "../messages.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";

/** The TypeBox schema of a `Delivery`. */
export const DeliveryType = Type.Enum(["steer", "queue", "attach"]);

/** The TypeBox schema of `UserContent`. */
export const UserContentType = Type.Union([
  Type.String(),
  Type.Array(
    Type.Union([
      Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
      Type.Object({
        kind: Type.Literal("file"),
        blob: idSchema<"blob">(),
        mime: Type.String(),
        name: Type.String(),
      }),
      Type.Object({ kind: Type.Literal("reference"), path: Type.String() }),
    ]),
  ),
]);

/** The TypeBox schema of a `Position`. */
export const PositionType = Type.Union([
  Type.Object({ kind: Type.Literal("start") }),
  Type.Object({ kind: Type.Literal("commit"), id: idSchema<"commit">() }),
]);

/** The TypeBox schema of a `MessageSource`. */
export const MessageSourceType = Type.Union([
  Type.Object({ kind: Type.Literal("user") }),
  Type.Object({ kind: Type.Literal("child"), session: idSchema<"session">() }),
  Type.Object({ kind: Type.Literal("job"), job: idSchema<"job">() }),
  Type.Object({ kind: Type.Literal("shell") }),
  Type.Object({
    kind: Type.Literal("action"),
    label: Type.String(),
    command: Type.Optional(Type.String()),
  }),
]);

/** The TypeBox schema of a `Schedule`. */
export const ScheduleType = Type.Union([
  Type.Object({ kind: Type.Literal("joined"), run: idSchema<"run">() }),
  Type.Object({
    kind: Type.Literal("next-turn"),
    reason: Type.Enum(["requested", "idle", "run-ended", "configuration"]),
  }),
  Type.Object({ kind: Type.Literal("attached") }),
]);

/** Validates a `Delivery`. */
export const DeliverySchema: Schema<Delivery> = standard(DeliveryType);

/** Validates `UserContent`. */
export const UserContentSchema: Schema<UserContent> = standard(UserContentType);

/** Validates a `Position`. */
export const PositionSchema: Schema<Position> = standard(PositionType);

/** Validates a `MessageSource`. */
export const MessageSourceSchema: Schema<MessageSource> = standard(MessageSourceType);

/** Validates a `Schedule`. */
export const ScheduleSchema: Schema<Schedule> = standard(ScheduleType);
