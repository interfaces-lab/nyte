import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { WorkspaceInfo } from "@nyte-ai/sdk/client";
import { restorableFolder } from "./window-workspace.ts";

function workspace(change: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: asId("w1"),
    target: { kind: "local", path: "/Users/me/project" },
    identity: asId("identity"),
    availability: { kind: "available" },
    projectResources: null,
    trusted: true,
    projectSources: [],
    addedBy: asId("owner"),
    sessions: 1,
    writers: [],
    isolation: null,
    ...change,
  };
}

const project = { id: "w1", path: "/Users/me/project", name: "project" };

test.each<{
  readonly name: string;
  readonly workspace: WorkspaceInfo | null;
  readonly folder:
    | { readonly id: string; readonly path: string; readonly name: string }
    | undefined;
}>([
  { name: "a folder the host can't describe shows nothing", workspace: null, folder: undefined },
  {
    name: "a folder the host can't reach shows nothing",
    workspace: workspace({ availability: { kind: "unavailable", reason: "unreachable" } }),
    folder: undefined,
  },
  {
    name: "a remote workspace shows nothing",
    workspace: workspace({ target: { kind: "ssh", locator: { host: "box" } } }),
    folder: undefined,
  },
  {
    name: "a local workspace without a path shows nothing",
    workspace: workspace({ target: { kind: "local", locator: { path: "/x" } } }),
    folder: undefined,
  },
  {
    name: "an untrusted folder with project sources waits for the trust question",
    workspace: workspace({ trusted: null, projectSources: ["AGENTS.md"] }),
    folder: undefined,
  },
  {
    name: "an untrusted folder without project sources shows",
    workspace: workspace({ trusted: null }),
    folder: project,
  },
  {
    name: "a trusted folder with project sources shows",
    workspace: workspace({ projectSources: ["AGENTS.md"] }),
    folder: project,
  },
  {
    name: "a folder whose trust was declined shows, since only an unanswered question waits",
    workspace: workspace({ trusted: false, projectSources: ["AGENTS.md"] }),
    folder: project,
  },
  {
    name: "the root folder shows with an empty name",
    workspace: workspace({ target: { kind: "local", path: "/" } }),
    folder: { id: "w1", path: "/", name: "" },
  },
])("restoring a chat's folder: $name", (row) => {
  expect(restorableFolder(row.workspace)).toEqual(row.folder);
});
