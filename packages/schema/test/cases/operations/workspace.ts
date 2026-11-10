import { OPERATIONS, asId } from "../../../src/index.ts";
import {
  operation,
  session,
  run,
  job,
  workspace,
  catalog,
  sharedDoc,
  workspaceInput,
  jobInput,
  jobView,
} from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

const beforeContextFiles = {
  commands: catalog.commands,
  skills: catalog.skills,
  docs: [sharedDoc],
};

export const workspaceOperations = {
  "workspace.info input": operation(OPERATIONS["workspace.info"].input, workspaceInput, {}),
  "workspace.catalog output": operation(
    OPERATIONS["workspace.catalog"].output,
    {
      ...beforeContextFiles,
      contextFiles: [
        {
          id: "context:project:AGENTS.md",
          name: "AGENTS.md",
          scope: "project",
          location: "/repo/AGENTS.md",
        },
      ],
    },
    beforeContextFiles,
  ),
  "workspace.command input": operation(
    OPERATIONS["workspace.command"].input,
    { workspace, name: "qa-probe", text: "the tests" },
    { workspace, text: "" },
  ),
  "workspace.completeCommand input": operation(
    OPERATIONS["workspace.completeCommand"].input,
    { workspace, name: "qa-probe", prefix: "" },
    { workspace, name: "qa-probe" },
  ),
  "workspace.watch input": operation(OPERATIONS["workspace.watch"].input, workspaceInput, {
    workspace: 1,
  }),
  "mcp.watch input": operation(OPERATIONS["mcp.watch"].input, workspaceInput, { workspace: 1 }),
  "mcp.reconnect input": operation(
    OPERATIONS["mcp.reconnect"].input,
    { workspace, server: "docs" },
    { workspace, server: 1 },
  ),
  "mcp.setEnabled input": operation(
    OPERATIONS["mcp.setEnabled"].input,
    { workspace, server: "docs", enabled: false },
    { workspace, server: "docs", enabled: "no" },
  ),
  "mcp.login input": operation(
    OPERATIONS["mcp.login"].input,
    { workspace, server: "docs" },
    { workspace },
  ),
  "mcp.login output": operation(OPERATIONS["mcp.login"].output, { login: "key" }, { login: 1 }),
  "mcp.logout input": operation(
    OPERATIONS["mcp.logout"].input,
    { workspace, server: "docs" },
    { server: "docs" },
  ),
  "mcp.add input": operation(
    OPERATIONS["mcp.add"].input,
    {
      workspace,
      server: "docs",
      config: { url: "https://docs.test/mcp", oauth: { clientId: "nyte", callbackPort: 8765 } },
      scope: "user",
    },
    { workspace, server: "docs", config: { url: "https://docs.test/mcp" }, scope: "global" },
  ),
  "mcp.remove input": operation(
    OPERATIONS["mcp.remove"].input,
    { workspace, server: "docs", scope: "project" },
    { workspace, server: "docs" },
  ),
  "workspace.update input": operation(
    OPERATIONS["workspace.update"].input,
    { workspace, patch: { projectResources: false } },
    { workspace, patch: { projectResources: "no" } },
  ),
  "workspace.update output": operation(
    OPERATIONS["workspace.update"].output,
    { kind: "missing" },
    { kind: "gone" },
  ),
  "workspace.reload input": operation(OPERATIONS["workspace.reload"].input, workspaceInput, {}),
  "workspace.reload output": operation(
    OPERATIONS["workspace.reload"].output,
    { kind: "updated" },
    {},
  ),
  "workspace.changes input": operation(
    OPERATIONS["workspace.changes"].input,
    { workspace, source: { kind: "run", run } },
    { workspace, run },
  ),
  "workspace.patches input": operation(
    OPERATIONS["workspace.patches"].input,
    {
      workspace,
      source: { kind: "session", session },
      paths: ["a.ts"],
      options: { ignoreWhitespace: false },
    },
    { workspace, source: { kind: "session", session }, paths: "a.ts" },
  ),
  "workspace.files input": operation(OPERATIONS["workspace.files"].input, workspaceInput, {}),
  "workspace.git input": operation(OPERATIONS["workspace.git"].input, workspaceInput, {}),
  "workspace.browser input": operation(OPERATIONS["workspace.browser"].input, workspaceInput, {}),
  "jobs.start input": operation(
    OPERATIONS["jobs.start"].input,
    {
      workspace,
      command: "npm test",
      session,
      title: "Tests",
      pty: { columns: 80, rows: 24 },
      id: job,
    },
    { workspace, pty: { columns: 80 } },
  ),
  "jobs.start output": operation(
    OPERATIONS["jobs.start"].output,
    { ...jobView, key: asId<"job-key">("jk1") },
    jobView,
  ),
  "jobs.recover input": operation(
    OPERATIONS["jobs.recover"].input,
    { workspace, key: asId<"job-key">("jk1") },
    { workspace },
  ),
  "jobs.recover output": operation(
    OPERATIONS["jobs.recover"].output,
    { kind: "ended", end: { kind: "lost" } },
    { kind: "ended" },
  ),
  "jobs.list input": operation(OPERATIONS["jobs.list"].input, workspaceInput, {}),
  "jobs.list output": operation(OPERATIONS["jobs.list"].output, [jobView], [{ id: job }]),
  "jobs.watch input": operation(OPERATIONS["jobs.watch"].input, workspaceInput, {}),
  "jobs.watch output": operation(OPERATIONS["jobs.watch"].output, { kind: "job", job: jobView }, [
    jobView,
  ]),
  "job.write input": operation(OPERATIONS["job.write"].input, jobInput, { workspace }),
  "job.write output": operation(OPERATIONS["job.write"].output, null, 1),
  "job.output input": operation(OPERATIONS["job.output"].input, jobInput, { job }),
  "job.resize input": operation(
    OPERATIONS["job.resize"].input,
    { ...jobInput, size: { columns: 120, rows: 40 } },
    { ...jobInput, size: { columns: 120 } },
  ),
  "job.resize output": operation(
    OPERATIONS["job.resize"].output,
    { kind: "not-pty" },
    { kind: "shrunk" },
  ),
  "job.idle input": operation(OPERATIONS["job.idle"].input, jobInput, {}),
  "job.idle output": operation(OPERATIONS["job.idle"].output, true, "yes"),
  "job.stop input": operation(OPERATIONS["job.stop"].input, jobInput, {}),
  "job.stop output": operation(
    OPERATIONS["job.stop"].output,
    { kind: "settled", outcome: { kind: "lost" } },
    { kind: "settled" },
  ),
  "job.settled input": operation(OPERATIONS["job.settled"].input, jobInput, {}),
  "workspace.github input": operation(OPERATIONS["workspace.github"].input, workspaceInput, {}),
} satisfies Record<string, Case>;
