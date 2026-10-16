import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

export const DeliveryType = Type.Enum(["steer", "queue", "attach"]);

export type Delivery = Decoded<typeof DeliveryType>;

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
      Type.Object({
        kind: Type.Literal("reference"),
        path: Type.String(),
        blob: Type.Optional(idSchema<"blob">()),
      }),
      Type.Object({ kind: Type.Literal("skill"), name: Type.String(), location: Type.String() }),
    ]),
  ),
]);

/**
 * What a message says: text, or parts. A `file` is an attachment the client
 * uploaded. A `reference` mentions a workspace file by `path`; the host reads
 * it once when the message is sent and keeps that text as `blob`, so every
 * request shows the model the file as it was then (a folder, or a file it
 * cannot read, stays a bare mention). A `skill` asks the model to follow the
 * skill at `location`. Clients draw `reference` and `skill` as chips.
 */
export type UserContent = Decoded<typeof UserContentType>;

export const PositionType = Type.Union([
  Type.Object({ kind: Type.Literal("start") }),
  Type.Object({ kind: Type.Literal("commit"), id: idSchema<"commit">() }),
]);

export type Position = Decoded<typeof PositionType>;

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

export type MessageSource = Decoded<typeof MessageSourceType>;

export const ScheduleType = Type.Union([
  Type.Object({ kind: Type.Literal("joined"), run: idSchema<"run">() }),
  Type.Object({
    kind: Type.Literal("next-turn"),
    reason: Type.Enum(["requested", "idle", "run-ended", "configuration"]),
  }),
  Type.Object({ kind: Type.Literal("attached") }),
]);

export type Schedule = Decoded<typeof ScheduleType>;

export const DeliverySchema: Schema<Delivery> = standard(DeliveryType);

export const UserContentSchema: Schema<UserContent> = standard(UserContentType);

export const PositionSchema: Schema<Position> = standard(PositionType);

export const MessageSourceSchema: Schema<MessageSource> = standard(MessageSourceType);

export const ScheduleSchema: Schema<Schedule> = standard(ScheduleType);
