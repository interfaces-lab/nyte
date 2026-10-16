import { Type } from "typebox";
import type { Delivery, MessageSource, Position, Schedule, UserContent } from "../messages.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";

export const DeliveryType = Type.Enum(["steer", "queue", "attach"]);

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

export const PositionType = Type.Union([
  Type.Object({ kind: Type.Literal("start") }),
  Type.Object({ kind: Type.Literal("commit"), id: idSchema<"commit">() }),
]);

export const MessageSourceType = Type.Union([
  Type.Object({ kind: Type.Literal("user") }),
  Type.Object({
    kind: Type.Literal("child"),
    session: idSchema<"session">(),
    end: Type.Enum(["completed", "stopped", "failed"]),
  }),
  Type.Object({ kind: Type.Literal("job"), job: idSchema<"job">() }),
  Type.Object({ kind: Type.Literal("shell") }),
  Type.Object({
    kind: Type.Literal("action"),
    label: Type.String(),
    command: Type.Optional(Type.String()),
  }),
]);

export const ScheduleType = Type.Union([
  Type.Object({ kind: Type.Literal("joined"), run: idSchema<"run">() }),
  Type.Object({
    kind: Type.Literal("next-turn"),
    reason: Type.Enum(["requested", "idle", "run-ended", "configuration"]),
  }),
  Type.Object({ kind: Type.Literal("attached") }),
]);

export const DeliverySchema: Schema<Delivery> = standard(DeliveryType);

export const UserContentSchema: Schema<UserContent> = standard(UserContentType);

export const PositionSchema: Schema<Position> = standard(PositionType);

export const MessageSourceSchema: Schema<MessageSource> = standard(MessageSourceType);

export const ScheduleSchema: Schema<Schedule> = standard(ScheduleType);
