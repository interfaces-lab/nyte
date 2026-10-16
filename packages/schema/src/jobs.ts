import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { base64Bytes } from "./wire/base64.ts";
import { nullable } from "./wire/nullable.ts";

export const EndReasonType = Type.Enum(["exited", "terminated", "expired", "host-lost"]);

export type EndReason = Decoded<typeof EndReasonType>;

export const JobEndType = Type.Union([
  Type.Object({
    kind: Type.Literal("exited"),
    code: nullable(Type.Number()),
    reason: EndReasonType,
  }),
  Type.Object({ kind: Type.Literal("lost") }),
]);

export type JobEnd = Decoded<typeof JobEndType>;

export const JobStateType = Type.Union([
  Type.Object({ kind: Type.Literal("running") }),
  JobEndType,
]);

export type JobState = Decoded<typeof JobStateType>;

export const JobViewType = Type.Object({
  id: idSchema<"job">(),
  command: Type.String(),
  title: Type.String(),
  session: nullable(idSchema<"session">()),
  pty: nullable(Type.Object({ columns: Type.Number(), rows: Type.Number(), shell: Type.String() })),
  state: JobStateType,
  startedAt: Type.Number(),
  endedAt: nullable(Type.Number()),
  tail: Type.String(),
});

export type JobView = Decoded<typeof JobViewType>;

export const OutputFrameType = Type.Union([
  Type.Object({ kind: Type.Literal("bytes"), data: base64Bytes }),
  Type.Object({ kind: Type.Literal("gap") }),
  Type.Object({ kind: Type.Literal("exit"), code: nullable(Type.Number()) }),
]);

export type OutputFrame = Decoded<typeof OutputFrameType>;

export const EndReasonSchema: Schema<EndReason> = standard(EndReasonType);

export const JobEndSchema: Schema<JobEnd> = standard(JobEndType);

export const JobStateSchema: Schema<JobState> = standard(JobStateType);

export const JobViewSchema: Schema<JobView> = standard(JobViewType);

export const OutputFrameSchema: Schema<OutputFrame> = standard(OutputFrameType);
