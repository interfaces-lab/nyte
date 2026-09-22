import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { Static } from "typebox";

const commandSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("cleanup"),
    signal: Type.Union([Type.Literal("SIGINT"), Type.Literal("SIGTERM")]),
  }),
  Type.Object({ kind: Type.Literal("finish") }),
  Type.Object({
    kind: Type.Literal("signal"),
    signal: Type.Union([Type.Literal("SIGINT"), Type.Literal("SIGTERM"), Type.Literal("SIGKILL")]),
  }),
]);

const reportSchema = Type.Union([
  Type.Object({ kind: Type.Literal("exited"), code: Type.Integer({ minimum: 0, maximum: 255 }) }),
  Type.Object({ kind: Type.Literal("prepared") }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
]);

/** Driver to supervisor, over the private IPC channel. */
export const supervisorCommand = Compile(commandSchema);

/** Supervisor to driver, over the private IPC channel. */
export const supervisorReport = Compile(reportSchema);

export type SupervisorReport = Static<typeof reportSchema>;
