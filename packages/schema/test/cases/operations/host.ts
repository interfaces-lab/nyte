import { OPERATIONS, asId } from "../../../src/index.ts";
import {
  operation,
  session,
  message,
  blob,
  receipt,
  workspace,
  cursor,
  identity,
  modelRef,
  sessionInfo,
  userContent,
  catalog,
  workspaceInfo,
  principal,
} from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const hostOperations = {
  "connection.watch input": operation(OPERATIONS["connection.watch"].input, {}, 1),
  "connection.blob input": operation(OPERATIONS["connection.blob"].input, { id: blob }, {}),
  "connection.blob output": operation(
    OPERATIONS["connection.blob"].output,
    "aGk=",
    "not base64!",
    Uint8Array.of(104, 105),
  ),
  "catalogs.read input": operation(
    OPERATIONS["catalogs.read"].input,
    { id: asId("3f8a1c2b9d0e4f71") },
    { id: 7 },
  ),
  "catalogs.read output": operation(OPERATIONS["catalogs.read"].output, catalog, {
    commands: [],
  }),
  "operations.describe input": operation(
    OPERATIONS["operations.describe"].input,
    { names: ["head.send"] },
    { names: "head.send" },
  ),
  "operations.describe output": operation(
    OPERATIONS["operations.describe"].output,
    [
      {
        name: "files.read",
        summary: "Reads a file.",
        kind: "query",
        authority: "participant",
        scope: "workspace",
        capability: "files",
        input: { type: "object" },
        output: { type: "object" },
      },
    ],
    [{ name: "files.read", summary: "Reads a file.", kind: "read" }],
  ),
  "models.list input": operation(OPERATIONS["models.list"].input, {}, 1),
  "models.accounts input": operation(
    OPERATIONS["models.accounts"].input,
    { provider: "test" },
    { provider: 1 },
  ),
  "models.accounts output": operation(OPERATIONS["models.accounts"].output, [], [{}]),
  "models.selectAccount input": operation(
    OPERATIONS["models.selectAccount"].input,
    { provider: "test", account: "work" },
    { provider: "test" },
  ),
  "models.selectAccount output": operation(OPERATIONS["models.selectAccount"].output, null, 0),
  "models.renameAccount input": operation(
    OPERATIONS["models.renameAccount"].input,
    { provider: "test", account: "work", label: "Work" },
    { provider: "test", account: "work" },
  ),
  "models.renameAccount output": operation(OPERATIONS["models.renameAccount"].output, null, 0),
  "models.usage input": operation(OPERATIONS["models.usage"].input, {}, 1),
  "models.usage output": operation(OPERATIONS["models.usage"].output, [], [{}]),
  "models.refresh input": operation(
    OPERATIONS["models.refresh"].input,
    { provider: "test" },
    { provider: 1 },
  ),
  "models.refresh output": operation(OPERATIONS["models.refresh"].output, null, 0),
  "models.setDefault input": operation(
    OPERATIONS["models.setDefault"].input,
    { ref: modelRef },
    { ref: { provider: "test" } },
  ),
  "models.setDefault output": operation(
    OPERATIONS["models.setDefault"].output,
    { kind: "unknown-model" },
    { kind: "unset" },
  ),
  "models.setListing input": operation(
    OPERATIONS["models.setListing"].input,
    { refs: [modelRef], listing: "favorite" },
    { refs: [modelRef], listing: "pinned" },
  ),
  "models.setListing output": operation(
    OPERATIONS["models.setListing"].output,
    { kind: "set" },
    { kind: "unset" },
  ),
  "models.verify input": operation(OPERATIONS["models.verify"].input, { provider: "test" }, {}),
  "models.verify output": operation(
    OPERATIONS["models.verify"].output,
    { kind: "failed", reason: "Expired." },
    { kind: "failed" },
  ),
  "models.login input": operation(
    OPERATIONS["models.login"].input,
    { provider: "test", method: { kind: "oauth" } },
    { provider: "test", method: { kind: "device" } },
  ),
  "models.login output": operation(OPERATIONS["models.login"].output, null, {}),
  "models.logout input": operation(
    OPERATIONS["models.logout"].input,
    { provider: "test" },
    { provider: null },
  ),
  "models.logout output": operation(OPERATIONS["models.logout"].output, null, false),
  "login.steps input": operation(OPERATIONS["login.steps"].input, { provider: "test" }, {}),
  "login.steps output": operation(
    OPERATIONS["login.steps"].output,
    { kind: "choose", message: "Pick.", options: [{ id: "a", label: "A" }] },
    { kind: "choose", message: "Pick." },
  ),
  "login.answer input": operation(
    OPERATIONS["login.answer"].input,
    { provider: "test", code: "123" },
    { provider: "test" },
  ),
  "login.answer output": operation(OPERATIONS["login.answer"].output, null, "done"),
  "settings.apply input": operation(
    OPERATIONS["settings.apply"].input,
    { id: "core/theme", value: { dark: [true] } },
    { id: "core/theme" },
  ),
  "projects.create input": operation(
    OPERATIONS["projects.create"].input,
    {
      input: {
        name: "Polish",
        workspace,
        models: { coordinator: modelRef, agents: null },
        instructions: "Read nyte-styles first.",
        skills: ["nyte-styles"],
        disabledMcp: ["linear"],
        disabledDocs: ["project:payments.md"],
      },
    },
    { input: { name: "Polish", workspace, instructions: "" } },
  ),
  "projects.draft input": operation(
    OPERATIONS["projects.draft"].input,
    { input: { goal: "Polish the settings screens for 0.42", workspace, model: modelRef } },
    { input: { goal: " \n ", workspace, model: modelRef } },
  ),
  "project.update input": operation(
    OPERATIONS["project.update"].input,
    { project: asId<"project">("p1"), patch: { instructions: "Read nyte-styles first." } },
    { project: asId<"project">("p1"), patch: { coordinator: session } },
  ),
  "workspaces.list input": operation(OPERATIONS["workspaces.list"].input, {}, 1),
  "workspaces.list output": operation(
    OPERATIONS["workspaces.list"].output,
    [workspaceInfo],
    [{ id: workspace }],
  ),
  "workspaces.inspect input": operation(
    OPERATIONS["workspaces.inspect"].input,
    { target: { kind: "local", path: "/repo" } },
    { target: { kind: "local" } },
  ),
  "workspaces.add input": operation(
    OPERATIONS["workspaces.add"].input,
    {
      target: { kind: "local", path: "/repo" },
      options: { projectResources: false, expect: { identity } },
    },
    { target: { kind: "local", path: "/repo" }, options: { expect: {} } },
  ),
  "workspaces.forget input": operation(
    OPERATIONS["workspaces.forget"].input,
    { id: workspace },
    { id: 1 },
  ),
  "workspaces.cleanWorktrees input": operation(
    OPERATIONS["workspaces.cleanWorktrees"].input,
    {},
    1,
  ),
  "sessions.start input": operation(
    OPERATIONS["sessions.start"].input,
    {
      id: session,
      name: "Parser",
      workspace,
      parent: session,
      configuration: { thinking: "high" },
      prompt: { kind: "layer", text: "Be brief.", order: 2 },
      content: userContent,
    },
    { name: "Parser" },
  ),
  "sessions.start output": operation(
    OPERATIONS["sessions.start"].output,
    { session, receipt, message },
    { session, receipt },
  ),
  "sessions.list input": operation(
    OPERATIONS["sessions.list"].input,
    { parents: { kind: "children", session }, cursor, limit: 10 },
    { cursor: 1 },
  ),
  "sessions.list output": operation(
    OPERATIONS["sessions.list"].output,
    { items: [sessionInfo], next: null },
    { items: [] },
  ),
  "sessions.read input": operation(
    OPERATIONS["sessions.read"].input,
    { parents: { kind: "roots" }, limit: 300, resume: { seq: 41 } },
    { resume: {} },
  ),
  "sessions.read output": operation(
    OPERATIONS["sessions.read"].output,
    { seq: 42, ids: [session], rows: [sessionInfo] },
    { seq: 42, ids: [session] },
  ),
  "host.tailnet.status input": operation(OPERATIONS["host.tailnet.status"].input, {}, 1),
  "host.tailnet.status output": operation(
    OPERATIONS["host.tailnet.status"].output,
    {
      state: "needs_login",
      authUrl: "https://login.tailscale.com/a/1",
      https: "pending",
      access: "owner",
      tags: [],
    },
    { state: "online", https: "pending", access: "owner", tags: [] },
  ),
  "host.tailnet.configure input": operation(
    OPERATIONS["host.tailnet.configure"].input,
    { enabled: true, hostname: "nyte", tags: ["tag:nyte"], access: "tailnet", authKey: "tskey" },
    { enabled: true, hostname: "Not A Name", tags: [], access: "owner" },
  ),
  "host.tailnet.configure output": operation(
    OPERATIONS["host.tailnet.configure"].output,
    {
      state: "running",
      dnsName: "nyte.example.ts.net",
      https: "available",
      access: "tailnet",
      tags: ["tag:nyte"],
    },
    { state: "running", https: "maybe", access: "tailnet", tags: [] },
  ),
  "host.tailnet.logout input": operation(OPERATIONS["host.tailnet.logout"].input, {}, null),
  "host.tailnet.logout output": operation(
    OPERATIONS["host.tailnet.logout"].output,
    { state: "disabled", https: "unavailable", access: "owner", tags: [] },
    { state: "disabled" },
  ),
  "mcp.approve input": operation(
    OPERATIONS["mcp.approve"].input,
    { code: "ABCD-EFGH", access: { kind: "ceiling", ceiling: "auto-edit" } },
    { code: "ABCD-EFGH", access: { kind: "ceiling", ceiling: "yolo" } },
  ),
  "mcp.approve output": operation(OPERATIONS["mcp.approve"].output, { client: "Claude" }, {}),
  "mcp.deny input": operation(OPERATIONS["mcp.deny"].input, { code: "ABCD-EFGH" }, {}),
  "mcp.deny output": operation(OPERATIONS["mcp.deny"].output, null, true),
  "mcp.grants.list input": operation(OPERATIONS["mcp.grants.list"].input, {}, null),
  "mcp.grants.list output": operation(
    OPERATIONS["mcp.grants.list"].output,
    [{ id: "g1", client: "Codex", access: { kind: "read-only" }, createdAt: 1 }],
    [{ id: "g1", client: "Codex", access: { kind: "write" }, createdAt: 1 }],
  ),
  "mcp.grants.revoke input": operation(OPERATIONS["mcp.grants.revoke"].input, { id: "g1" }, {}),
  "mcp.grants.revoke output": operation(OPERATIONS["mcp.grants.revoke"].output, null, true),
} satisfies Record<string, Case>;

export const maintenanceOperations = {
  "plugins.replace input": operation(
    OPERATIONS["plugins.replace"].input,
    { plugins: [{ path: "/plugins/maps.ts" }], scope: { session } },
    { plugins: [{ id: "maps" }] },
  ),
  "plugins.check input": operation(
    OPERATIONS["plugins.check"].input,
    { plugins: [{ path: "/plugins/maps.ts" }] },
    { plugins: ["/plugins/maps.ts"] },
  ),
  "principals.list input": operation(OPERATIONS["principals.list"].input, {}, 1),
  "principals.list output": operation(
    OPERATIONS["principals.list"].output,
    [{ id: principal, label: "Phone", authority: ["participant"], pairedAt: 1 }],
    [{ id: principal, label: "Phone", authority: "participant", pairedAt: 1 }],
  ),
  "principals.pair input": operation(
    OPERATIONS["principals.pair"].input,
    { authority: ["participant", "owner"], label: "Phone" },
    { authority: ["root"] },
  ),
  "principals.pair output": operation(
    OPERATIONS["principals.pair"].output,
    { code: "123-456", expiresAt: 1 },
    { code: "123-456" },
  ),
  "principals.revoke input": operation(
    OPERATIONS["principals.revoke"].input,
    { id: principal },
    {},
  ),
  "principals.revoke output": operation(OPERATIONS["principals.revoke"].output, null, true),
} satisfies Record<string, Case>;
