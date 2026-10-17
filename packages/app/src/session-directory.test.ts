import { asId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { sessionRow } from "../test/view-fixtures.ts";
import { groupDirectory, localSessions } from "./session-directory.ts";

it("keeps each workspace's sessions when two registrations have the same path", () => {
  const original = asId<"workspace">("original");
  const replacement = asId<"workspace">("replacement");

  const directories = groupDirectory(
    [
      sessionRow("old-chat", { workspace: original }),
      sessionRow("new-chat", { workspace: replacement }),
    ],
    [
      { id: original, path: "/work/project" },
      { id: replacement, path: "/work/project" },
    ],
  );

  expect(localSessions(directories, original)?.map((session) => session.id)).toEqual(["old-chat"]);
  expect(localSessions(directories, replacement)?.map((session) => session.id)).toEqual([
    "new-chat",
  ]);
  expect(
    directories.flatMap((directory) => directory.sessions.map((session) => session.id)),
  ).toEqual(["old-chat", "new-chat"]);
});

it("collects every unbacked workspace in Home without taking a folder's sessions", () => {
  const folder = asId<"workspace">("folder");

  const directories = groupDirectory(
    [
      sessionRow("first-home-chat", { workspace: asId("first-home") }),
      sessionRow("folder-chat", { workspace: folder }),
      sessionRow("second-home-chat", { workspace: asId("second-home") }),
    ],
    [{ id: folder, path: "/work/project" }],
  );

  expect(localSessions(directories, null)?.map((session) => session.id)).toEqual([
    "first-home-chat",
    "second-home-chat",
  ]);
  expect(localSessions(directories, folder)?.map((session) => session.id)).toEqual(["folder-chat"]);
});

it("lists a chat in a worktree under the folder the worktree was made from", () => {
  const folder = asId<"workspace">("folder");
  const worktree = asId<"workspace">("worktree");

  const directories = groupDirectory(
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

  expect(localSessions(directories, folder)?.map((session) => session.id)).toEqual([
    "folder-chat",
    "worktree-chat",
  ]);
  expect(localSessions(directories, worktree)).toBeUndefined();
});
