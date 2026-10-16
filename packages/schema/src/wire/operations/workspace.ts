import { Type } from "typebox";
import { ChangeSetSchema, DiffOptionsType, PatchSetWireSchema } from "../git.ts";
import { idSchema } from "../ids.ts";
import { JobEndSchema, JobEndType, JobViewType, OutputFrameSchema } from "../jobs.ts";
import { McpChangeSchema, McpServerConfigType, McpViewSchema } from "../mcp.ts";
import { nullable } from "../nullable.ts";
import { CapabilityWireSchema } from "../primitives.ts";
import { stopOutcomeSchema } from "../runs.ts";
import { WorkspaceInfoSchema } from "../workspaces.ts";
import { NOTHING, ON_WORKSPACE, wireObject, wireSchema, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "workspace" } as const;

const OWNER = { authority: "owner", scope: "workspace" } as const;

const JOB = { ...WORKSPACE, job: idSchema<"job">() };

const JOB_HANDLE = Type.Object({ ...JobViewType.properties, key: nullable(idSchema<"job-key">()) });

const ON_JOB = wireObject(JOB);

const WORKSPACE_CHANGE = wireSchema(
  Type.Union([
    Type.Object({ kind: Type.Literal("updated") }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

const JOBS = wireSchema(Type.Array(JobViewType));

const ON_SERVER = wireObject({ ...WORKSPACE, server: Type.String() });

export const WORKSPACE_OPERATIONS = {
  "workspace.info": {
    ...PARTICIPANT,
    kind: "query",
    input: ON_WORKSPACE,
    output: WorkspaceInfoSchema,
  },
  "workspace.watch": {
    ...PARTICIPANT,
    kind: "watch",
    input: ON_WORKSPACE,
    output: WorkspaceInfoSchema,
  },
  "mcp.watch": { ...OWNER, kind: "watch", input: ON_WORKSPACE, output: McpViewSchema },
  "mcp.reconnect": { ...OWNER, kind: "command", input: ON_SERVER, output: McpChangeSchema },
  "mcp.setEnabled": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      server: Type.String(),
      enabled: Type.Boolean(),
    }),
    output: McpChangeSchema,
  },
  "mcp.login": {
    ...OWNER,
    kind: "command",
    input: ON_SERVER,
    output: wireObject({ login: Type.String() }),
  },
  "mcp.logout": { ...OWNER, kind: "command", input: ON_SERVER, output: McpChangeSchema },
  "mcp.add": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      server: Type.String(),
      config: McpServerConfigType,
      scope: Type.Enum(["user", "project"]),
    }),
    output: McpChangeSchema,
  },
  "mcp.remove": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      server: Type.String(),
      scope: Type.Enum(["user", "project"]),
    }),
    output: McpChangeSchema,
  },
  "workspace.update": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      patch: Type.Object({ projectResources: Type.Optional(nullable(Type.Boolean())) }),
    }),
    output: WORKSPACE_CHANGE,
  },
  "workspace.reload": { ...OWNER, kind: "command", input: ON_WORKSPACE, output: WORKSPACE_CHANGE },
  "workspace.changes": {
    ...PARTICIPANT,
    kind: "query",
    input: wireObject({ ...WORKSPACE, run: idSchema<"run">() }),
    output: ChangeSetSchema,
  },
  "workspace.patches": {
    ...PARTICIPANT,
    kind: "stream",
    input: wireObject({
      ...WORKSPACE,
      run: idSchema<"run">(),
      paths: Type.Array(Type.String()),
      options: Type.Optional(DiffOptionsType),
    }),
    output: PatchSetWireSchema,
  },
  "workspace.files": {
    ...PARTICIPANT,
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "workspace.git": {
    ...PARTICIPANT,
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "workspace.browser": {
    ...PARTICIPANT,
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "jobs.start": {
    ...PARTICIPANT,
    kind: "command",
    recovery: "replay",
    input: wireObject({
      ...WORKSPACE,
      command: Type.Optional(Type.String()),
      session: Type.Optional(idSchema<"session">()),
      title: Type.Optional(Type.String()),
      pty: Type.Optional(Type.Object({ columns: Type.Number(), rows: Type.Number() })),
      id: Type.Optional(idSchema<"job">()),
    }),
    output: wireSchema(JOB_HANDLE),
  },
  "jobs.recover": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({ ...WORKSPACE, key: idSchema<"job-key">() }),
    output: wireSchema(
      Type.Union([
        JOB_HANDLE,
        Type.Object({ kind: Type.Literal("ended"), end: JobEndType }),
        Type.Object({ kind: Type.Literal("missing") }),
      ]),
    ),
  },
  "jobs.list": { ...PARTICIPANT, kind: "query", input: ON_WORKSPACE, output: JOBS },
  "jobs.watch": { ...PARTICIPANT, kind: "watch", input: ON_WORKSPACE, output: JOBS },
  "job.write": {
    ...PARTICIPANT,
    kind: "command",
    recovery: "never",
    input: ON_JOB,
    output: NOTHING,
  },
  "job.output": { ...PARTICIPANT, kind: "stream", input: ON_JOB, output: OutputFrameSchema },
  "job.resize": {
    ...PARTICIPANT,
    kind: "command",
    input: wireObject({
      ...JOB,
      size: Type.Object({ columns: Type.Number(), rows: Type.Number() }),
    }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("resized") }),
        Type.Object({ kind: Type.Literal("not-pty") }),
        Type.Object({ kind: Type.Literal("missing") }),
      ]),
    ),
  },
  "job.idle": { ...PARTICIPANT, kind: "query", input: ON_JOB, output: wireSchema(Type.Boolean()) },
  "job.stop": {
    ...PARTICIPANT,
    kind: "command",
    input: ON_JOB,
    output: stopOutcomeSchema(JobEndType),
  },
  "job.settled": { ...PARTICIPANT, kind: "query", wait: true, input: ON_JOB, output: JobEndSchema },
} as const satisfies OperationRows;
