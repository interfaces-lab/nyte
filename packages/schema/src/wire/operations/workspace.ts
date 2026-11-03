import { Type } from "typebox";
import {
  ChangeSetSchema,
  ChangeSourceType,
  DiffOptionsType,
  PatchSetWireSchema,
} from "../../git.ts";
import { idSchema } from "../../ids.ts";
import {
  JobEndSchema,
  JobEndType,
  JobsChangeType,
  JobViewType,
  OutputFrameSchema,
} from "../../jobs.ts";
import { McpChangeSchema, McpServerConfigType, McpViewSchema } from "../../mcp.ts";
import { nullable } from "../nullable.ts";
import { CapabilityWireSchema } from "../../primitives.ts";
import { stopOutcomeSchema } from "../../runs.ts";
import {
  CommandCompletionsSchema,
  WorkspaceCatalogViewType,
  WorkspaceCommandOutcomeSchema,
} from "../../sessions.ts";
import { WorkspaceInfoSchema } from "../../workspaces.ts";
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
    mcp: "read",
    summary: "Reads the workspace's folder, trust and state.",
    kind: "query",
    input: ON_WORKSPACE,
    output: WorkspaceInfoSchema,
  },
  "workspace.watch": {
    ...PARTICIPANT,
    summary: "Streams the workspace's info each time it changes.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: WorkspaceInfoSchema,
  },
  "workspace.catalog": {
    ...PARTICIPANT,
    summary: "Lists the commands and skills a new chat in the workspace would offer.",
    kind: "query",
    input: ON_WORKSPACE,
    output: wireSchema(WorkspaceCatalogViewType),
  },
  "workspace.command": {
    ...PARTICIPANT,
    summary: "Runs a workspace command without a chat, with the text typed after it.",
    kind: "command",
    input: wireObject({ ...WORKSPACE, name: Type.String(), text: Type.String() }),
    output: WorkspaceCommandOutcomeSchema,
  },
  "workspace.completeCommand": {
    ...PARTICIPANT,
    summary: "Returns completions for the text after a workspace command.",
    kind: "query",
    input: wireObject({ ...WORKSPACE, name: Type.String(), prefix: Type.String() }),
    output: CommandCompletionsSchema,
  },
  "mcp.watch": {
    ...OWNER,
    summary: "Streams the workspace's MCP servers and their state as they change.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: McpViewSchema,
  },
  "mcp.reconnect": {
    ...OWNER,
    summary: "Reconnects an MCP server, for one that failed or after fixing its credentials.",
    kind: "command",
    input: ON_SERVER,
    output: McpChangeSchema,
  },
  "mcp.setEnabled": {
    ...OWNER,
    summary: "Turns an MCP server on or off in the mcp.json that defines it.",
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
    summary: "Starts an OAuth sign-in to an MCP server and returns its login id.",
    kind: "command",
    input: ON_SERVER,
    output: wireObject({ login: Type.String() }),
  },
  "mcp.logout": {
    ...OWNER,
    summary: "Deletes an MCP server's stored OAuth credentials.",
    kind: "command",
    input: ON_SERVER,
    output: McpChangeSchema,
  },
  "mcp.add": {
    ...OWNER,
    summary: "Adds or replaces an MCP server in the user or project mcp.json.",
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
    summary: "Removes an MCP server from the user or project mcp.json.",
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
    summary: "Sets whether the workspace's folder trusts its project files.",
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      patch: Type.Object({ projectResources: Type.Optional(nullable(Type.Boolean())) }),
    }),
    output: WORKSPACE_CHANGE,
  },
  "workspace.reload": {
    ...OWNER,
    summary: "Reloads the workspace's project files and the plugins of its live sessions.",
    kind: "command",
    input: ON_WORKSPACE,
    output: WORKSPACE_CHANGE,
  },
  "workspace.changes": {
    ...PARTICIPANT,
    summary: "Lists the files a run or session changed.",
    kind: "query",
    input: wireObject({ ...WORKSPACE, source: ChangeSourceType }),
    output: ChangeSetSchema,
  },
  "workspace.patches": {
    ...PARTICIPANT,
    summary: "Streams the patches of the given files that a run or session changed.",
    kind: "stream",
    input: wireObject({
      ...WORKSPACE,
      source: ChangeSourceType,
      paths: Type.Array(Type.String()),
      options: Type.Optional(DiffOptionsType),
    }),
    output: PatchSetWireSchema,
  },
  "workspace.files": {
    ...PARTICIPANT,
    summary: "Checks whether the workspace offers file access.",
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "workspace.git": {
    ...PARTICIPANT,
    summary: "Checks whether the workspace offers git.",
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "workspace.github": {
    ...PARTICIPANT,
    summary: "Checks whether the workspace offers GitHub through gh.",
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "workspace.browser": {
    ...PARTICIPANT,
    summary: "Checks whether the workspace offers a browser.",
    kind: "query",
    input: ON_WORKSPACE,
    output: CapabilityWireSchema,
  },
  "jobs.start": {
    ...PARTICIPANT,
    summary: "Starts a job running a command or shell, optionally in a terminal of a given size.",
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
    summary: "Finds a job again by its key, or reports how it ended or that it is gone.",
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
  "jobs.list": {
    ...PARTICIPANT,
    summary: "Lists the workspace's jobs.",
    kind: "query",
    input: ON_WORKSPACE,
    output: JOBS,
  },
  "jobs.watch": {
    ...PARTICIPANT,
    summary: "Streams the workspace's jobs as they change.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: wireSchema(JobsChangeType),
  },
  "job.write": {
    ...PARTICIPANT,
    summary: "Sends the request body to a job's input.",
    kind: "command",
    recovery: "never",
    input: ON_JOB,
    output: NOTHING,
  },
  "job.output": {
    ...PARTICIPANT,
    summary: "Streams the bytes of a job's output.",
    kind: "stream",
    input: ON_JOB,
    output: OutputFrameSchema,
  },
  "job.resize": {
    ...PARTICIPANT,
    summary: "Resizes a job's terminal.",
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
  "job.idle": {
    ...PARTICIPANT,
    summary:
      "Checks whether a job's terminal has nothing running, such as a shell back at its prompt.",
    kind: "query",
    input: ON_JOB,
    output: wireSchema(Type.Boolean()),
  },
  "job.stop": {
    ...PARTICIPANT,
    summary: "Stops a job.",
    kind: "command",
    input: ON_JOB,
    output: stopOutcomeSchema(JobEndType),
  },
  "job.settled": {
    ...PARTICIPANT,
    summary: "Waits until a job ends and returns how it ended.",
    kind: "query",
    wait: true,
    input: ON_JOB,
    output: JobEndSchema,
  },
} as const satisfies OperationRows;
