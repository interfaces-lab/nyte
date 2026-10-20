import { asId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { sessionRow } from "../test/view-fixtures.ts";
import { groupByWorkspace, localSessions } from "./session-list.ts";

it("keeps each workspace's sessions when two registrations have the same path", () => {
  const original = asId<"workspace">("original");
  const replacement = asId<"workspace">("replacement");

  const groups = groupByWorkspace(
    [
      sessionRow("old-chat", { workspace: original }),
      sessionRow("new-chat", { workspace: replacement }),
    ],
    [
      { id: original, path: "/work/project" },
      { id: replacement, path: "/work/project" },
    ],
  );

  expect(localSessions(groups, original)?.map((session) => session.id)).toEqual(["old-chat"]);
  expect(localSessions(groups, replacement)?.map((session) => session.id)).toEqual(["new-chat"]);
  expect(groups.flatMap((group) => group.sessions.map((session) => session.id))).toEqual([
    "old-chat",
    "new-chat",
  ]);
});

it("collects every unbacked workspace in Home without taking a folder's sessions", () => {
  const folder = asId<"workspace">("folder");

  const groups = groupByWorkspace(
    [
      sessionRow("first-home-chat", { workspace: asId("first-home") }),
      sessionRow("folder-chat", { workspace: folder }),
      sessionRow("second-home-chat", { workspace: asId("second-home") }),
    ],
    [{ id: folder, path: "/work/project" }],
  );

  expect(localSessions(groups, null)?.map((session) => session.id)).toEqual([
    "first-home-chat",
    "second-home-chat",
  ]);
  expect(localSessions(groups, folder)?.map((session) => session.id)).toEqual(["folder-chat"]);
});

it("lists a chat in a worktree under the folder the worktree was made from", () => {
  const folder = asId<"workspace">("folder");
  const worktree = asId<"workspace">("worktree");

  const groups = groupByWorkspace(
    [
      sessionRow("folder-chat", { workspace: folder }),
      sessionRow("worktree-chat", { workspace: worktree }),
    ],
    [
      { id: folder, path: "/work/project", worktree: null },
      {
        id: worktree,
        path: "/home/ada/.nyte/worktrees/project/fix",
        worktree: { source: folder },
      },
    ],
  );

  expect(localSessions(groups, folder)?.map((session) => session.id)).toEqual([
    "folder-chat",
    "worktree-chat",
  ]);
  expect(localSessions(groups, worktree)).toBeUndefined();
});
