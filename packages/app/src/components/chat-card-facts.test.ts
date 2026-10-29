import { expect, test } from "vitest";
import type { GitStatus, SessionInfo, WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { chatsFor, sessionRow, workspaceRow } from "../../test/view-fixtures.ts";
import type { Chat } from "../chats/index.ts";
import { chatCardFacts } from "./chat-card-facts.ts";

const project = workspaceRow("project", "/Users/ada/Developer/nyte");

const worktree = workspaceRow("worktree", "/Users/ada/.nyte/worktrees/nyte/fix-scroll", {
  kind: "worktree",
  source: project.id,
  session: asId<"session">("chat"),
  branch: "fix-scroll",
  base: "main",
});

function chat(session: Partial<SessionInfo>, workspaces: readonly WorkspaceInfo[]): Chat {
  const row = sessionRow("chat", session);
  const joined = chatsFor([row], { workspaces }).get(row.id);

  if (joined === undefined) throw new Error("The directory lost the chat.");

  return joined;
}

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
      chat: chat({ name: "Fix the scroll", workspace: project.id }, [project]),
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
      chat: chat({ name: null, workspace: worktree.id }, [project, worktree]),
      git: undefined,
      repository: undefined,
      surface: "web",
    }),
  ).toEqual({
    title: "New chat",
    facts: [
      { kind: "repository", text: "nyte", detail: "fix-scroll", copy: "fix-scroll" },
      {
        kind: "worktree",
        text: "fix-scroll",
        detail: "Worktree",
        copy: "/Users/ada/.nyte/worktrees/nyte/fix-scroll",
      },
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
  const plain = workspaceRow("project", "/srv/notes");

  expect(
    chatCardFacts({
      chat: chat({ name: "Notes", workspace: plain.id }, [plain]),
      git: { kind: "none" },
      repository: undefined,
      surface: "desktop",
    }).facts,
  ).toEqual([{ kind: "folder", text: "/srv/notes", detail: "Local", copy: "/srv/notes" }]);

  expect(
    chatCardFacts({
      chat: chat({ name: "Home", workspace: asId<"workspace">("home") }, [plain]),
      git: undefined,
      repository: undefined,
      surface: "desktop",
    }),
  ).toEqual({ title: "Home", facts: [] });
});
