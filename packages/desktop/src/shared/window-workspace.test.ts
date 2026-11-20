import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { WorkspaceInfo } from "@nyte-ai/sdk/client";
import type { WindowEnd } from "./host-window.ts";
import { createWindowWorkspaces, restorableFolder } from "./window-workspace.ts";

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

const seed = "/seed";

const picked = "/picked";

type Step =
  | { readonly kind: "opened"; readonly seed?: string }
  | { readonly kind: "shown"; readonly workspace: string | undefined }
  | { readonly kind: "ended"; readonly end: WindowEnd };

test.each<{
  readonly name: string;
  readonly steps: readonly Step[];
  readonly shown: string | undefined;
}>([
  { name: "a new window shows Home", steps: [{ kind: "opened" }], shown: undefined },
  {
    name: "a window Finder opened starts on its folder",
    steps: [{ kind: "opened", seed }],
    shown: seed,
  },
  {
    name: "the folder a page says it shows",
    steps: [{ kind: "opened" }, { kind: "shown", workspace: picked }],
    shown: picked,
  },
  {
    name: "Home chosen in a window Finder opened",
    steps: [
      { kind: "opened", seed },
      { kind: "shown", workspace: undefined },
    ],
    shown: undefined,
  },
  {
    name: "a window Finder opened that chose Home starts on its folder after a reload, as its page does",
    steps: [
      { kind: "opened", seed },
      { kind: "shown", workspace: undefined },
      { kind: "ended", end: "navigated" },
    ],
    shown: seed,
  },
  {
    name: "a folder the old page opened is gone after a reload until the new page says it",
    steps: [
      { kind: "opened" },
      { kind: "shown", workspace: picked },
      { kind: "ended", end: "navigated" },
    ],
    shown: undefined,
  },
  {
    name: "a crashed page leaves the folder Finder opened",
    steps: [
      { kind: "opened", seed },
      { kind: "shown", workspace: picked },
      { kind: "ended", end: "crashed" },
    ],
    shown: seed,
  },
  {
    name: "a closed window shows nothing, and a late word from it changes nothing",
    steps: [
      { kind: "opened", seed },
      { kind: "ended", end: "closed" },
      { kind: "shown", workspace: picked },
    ],
    shown: undefined,
  },
])("a window's workspace in main: $name", (row) => {
  const workspaces = createWindowWorkspaces();
  workspaces.opened(2, picked);

  for (const step of row.steps) {
    if (step.kind === "opened") workspaces.opened(1, step.seed);
    else if (step.kind === "shown") workspaces.shown(1, step.workspace);
    else workspaces.windowEnded(1, step.end);
  }

  expect([workspaces.workspace(1), workspaces.workspace(2)]).toEqual([row.shown, picked]);
});
