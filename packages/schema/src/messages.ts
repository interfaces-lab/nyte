import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

export const DeliveryType = Type.Enum(["steer", "queue", "attach"]);

export type Delivery = Decoded<typeof DeliveryType>;

export const ExcerptSourceType = Type.Union([
  Type.Object({
    kind: Type.Literal("diff"),
    path: Type.String(),
    side: Type.Enum(["old", "new"]),
    start: Type.Number(),
    end: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("terminal"), command: Type.Optional(Type.String()) }),
  Type.Object({ kind: Type.Literal("browser"), url: Type.String(), selector: Type.String() }),
]);

/**
 * Where an excerpt was taken from. A `diff` range names the file and the
 * lines `start` to `end` on one side of its change: `new` counts in the file
 * as it is now, `old` as it was before. A `terminal` selection names the
 * command line its output followed, when one is known. A `browser` element
 * names the page `url` and a CSS `selector` that finds it there.
 */
export type ExcerptSource = Decoded<typeof ExcerptSourceType>;

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
      Type.Object({
        kind: Type.Literal("excerpt"),
        source: ExcerptSourceType,
        text: Type.String(),
      }),
    ]),
  ),
]);

/**
 * What a message says: text, or parts. A `file` is an attachment the client
 * uploaded. A `reference` mentions a workspace file by `path`; the host reads
 * it once when the message is sent and keeps that text as `blob`, so every
 * request shows the model the file as it was then (a folder, or a file it
 * cannot read, stays a bare mention). A `skill` asks the model to follow the
 * skill at `location`. An `excerpt` is text the user took from a workbench
 * panel, kept exactly as taken: a diff range's hunk, a terminal selection, or a
 * page element's HTML; the model reads it with its `source`. Clients draw
 * `reference`, `skill` and `excerpt` as chips.
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
  Type.Object({ kind: Type.Literal("deciding") }),
]);

/** When an admitted input runs. `deciding` is a chat's first message, admitted with the chat while its before_send hooks decide it; nothing on its head runs until they do. */
export type Schedule = Decoded<typeof ScheduleType>;

export const DeliverySchema: Schema<Delivery> = standard(DeliveryType);

export const UserContentSchema: Schema<UserContent> = standard(UserContentType);

export const PositionSchema: Schema<Position> = standard(PositionType);

export const MessageSourceSchema: Schema<MessageSource> = standard(MessageSourceType);

export const ScheduleSchema: Schema<Schedule> = standard(ScheduleType);
