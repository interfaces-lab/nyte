import { expect, test } from "vitest";
import type { GitStatus } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { chatCardFacts } from "./chat-card-facts.ts";

const project = {
  id: asId<"workspace">("project"),
  path: "/Users/ada/Developer/nyte",
  name: "nyte",
  worktree: null,
};

const worktree = {
  id: asId<"workspace">("worktree"),
  path: "/Users/ada/.nyte/worktrees/nyte/fix-scroll",
  name: "fix-scroll",
  worktree: { source: project.id, branch: "fix-scroll" },
};

function repository(branch: string | null): GitStatus {
  return {
    kind: "repository",
    root: "/Users/ada/Developer/nyte",
    head: null,
    branch,
    upstream: null,
    revision: asId<"git-revision">("r1"),
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
  };
}

test("a local git chat shows its repository with the branch, then its folder under ~", () => {
  expect(
    chatCardFacts({
      session: { name: "Fix the scroll", workspace: project.id },
      workspaces: [project],
      git: repository("main"),
      repository: { owner: "nyte-ai", name: "nyte" },
      surface: "desktop",
    }),
  ).toEqual({
    title: "Fix the scroll",
    facts: [
      { kind: "repository", text: "nyte-ai/nyte", detail: "main", copy: "main" },
      {
        kind: "folder",
        text: "~/Developer/nyte",
        detail: "Local",
        copy: "/Users/ada/Developer/nyte",
      },
    ],
  });
});

test("a worktree chat names its worktree before the folder it was made from", () => {
  expect(
    chatCardFacts({
      session: { name: null, workspace: worktree.id },
      workspaces: [project, worktree],
      git: undefined,
      repository: undefined,
      surface: "web",
    }),
  ).toEqual({
    title: "New chat",
    facts: [
      { kind: "repository", text: "nyte", detail: "fix-scroll", copy: "fix-scroll" },
      { kind: "worktree", text: "fix-scroll", detail: "Worktree", copy: worktree.path },
      {
        kind: "folder",
        text: "~/Developer/nyte",
        detail: "Remote",
        copy: "/Users/ada/Developer/nyte",
      },
    ],
  });
});

test("a folder outside git shows the folder alone, and a chat outside any listed folder only its title", () => {
  const plain = { ...project, path: "/srv/notes", name: "notes" };

  expect(
    chatCardFacts({
      session: { name: "Notes", workspace: plain.id },
      workspaces: [plain],
      git: { kind: "none" },
      repository: undefined,
      surface: "desktop",
    }).facts,
  ).toEqual([{ kind: "folder", text: "/srv/notes", detail: "Local", copy: "/srv/notes" }]);

  expect(
    chatCardFacts({
      session: { name: "Home", workspace: asId<"workspace">("home") },
      workspaces: [plain],
      git: undefined,
      repository: undefined,
      surface: "desktop",
    }),
  ).toEqual({ title: "Home", facts: [] });
});
