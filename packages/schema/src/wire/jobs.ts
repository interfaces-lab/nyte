import { Type } from "typebox";
import type { EndReason, JobEnd, JobState, JobView, OutputFrame } from "../jobs.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { base64Bytes } from "./base64.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of an `EndReason`. */
export const EndReasonType = Type.Enum(["exited", "terminated", "expired", "host-lost"]);

/** The TypeBox schema of a `JobEnd`. */
export const JobEndType = Type.Union([
  Type.Object({
    kind: Type.Literal("exited"),
    code: nullable(Type.Number()),
    reason: EndReasonType,
  }),
  Type.Object({ kind: Type.Literal("lost") }),
]);

/** The TypeBox schema of a `JobState`. */
export const JobStateType = Type.Union([
  Type.Object({ kind: Type.Literal("running") }),
  JobEndType,
]);

/** The TypeBox schema of a `JobView`. */
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

/** The TypeBox schema of an `OutputFrame`; `bytes` data travels as base64 and decodes to bytes. */
export const OutputFrameType = Type.Union([
  Type.Object({ kind: Type.Literal("bytes"), data: base64Bytes }),
  Type.Object({ kind: Type.Literal("gap") }),
  Type.Object({ kind: Type.Literal("exit"), code: nullable(Type.Number()) }),
]);

/** Validates an `EndReason`. */
export const EndReasonSchema: Schema<EndReason> = standard(EndReasonType);

/** Validates a `JobEnd`. */
export const JobEndSchema: Schema<JobEnd> = standard(JobEndType);

/** Validates a `JobState`. */
export const JobStateSchema: Schema<JobState> = standard(JobStateType);

/** Validates a `JobView`. */
export const JobViewSchema: Schema<JobView> = standard(JobViewType);

/** Validates an `OutputFrame`. */
export const OutputFrameSchema: Schema<OutputFrame> = standard(OutputFrameType);
