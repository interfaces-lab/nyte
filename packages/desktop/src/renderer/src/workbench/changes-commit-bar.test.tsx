/**
 * The commit surface's decisions, checked without a renderer: which steps an
 * action runs, which actions cannot apply, and the sentence each outcome gets.
 */
import { afterAll, describe, expect, test, vi } from "vitest";

// The module graph reaches the renderer's bridge and theme at import time.
vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});
afterAll(() => vi.unstubAllGlobals());

import {
  actionFailureMessage,
  COMMIT_ACTIONS,
  commitActionDisabledReason,
  commitActionLabel,
  commitActionPlan,
  commitInputFor,
  commitResultMessage,
  createBranchResultMessage,
  DEFAULT_COMMIT_ACTION,
  isWorkingTreeScope,
  pullRequestResultMessage,
  pullRequestTitle,
  pushResultMessage,
} from "./changes-commit-bar.tsx";
import type { CommitBarState } from "./changes-commit-bar.tsx";
import { bridgeError } from "../../../shared/errors.ts";
import type { BranchReadout } from "./change-scopes.ts";

const tracking: BranchReadout = {
  label: "main",
  detached: false,
  unborn: false,
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
};

function state(overrides: Partial<CommitBarState> = {}): CommitBarState {
  return {
    scope: { kind: "uncommitted" },
    fileCount: 2,
    message: "fix(desktop): commit the change",
    branch: tracking,
    ...overrides,
  };
}

describe("commit actions", () => {
  test("the menu offers every action, and the default one is Commit and push", () => {
    expect(COMMIT_ACTIONS.map(commitActionLabel)).toEqual([
      "Create branch and commit",
      "Create branch, commit and push",
      "Create branch",
      "Commit",
      "Commit and push",
      "Commit and create pull request",
      "Push",
      "Create pull request",
    ]);
    expect(commitActionLabel(DEFAULT_COMMIT_ACTION)).toBe("Commit and push");
  });

  test("each action runs the steps its label names", () => {
    expect(commitActionPlan("branch-commit-push")).toEqual({
      branch: true,
      commit: true,
      push: true,
      pullRequest: false,
    });
    expect(commitActionPlan("commit-pull-request")).toEqual({
      branch: false,
      commit: true,
      push: false,
      pullRequest: true,
    });
    expect(commitActionPlan("push")).toEqual({
      branch: false,
      commit: false,
      push: true,
      pullRequest: false,
    });
  });

  test("a staged scope commits the index; every other working scope commits tracked changes", () => {
    expect(commitInputFor({ kind: "staged" }, "subject")).toEqual({ message: "subject" });
    expect(commitInputFor({ kind: "uncommitted" }, "subject")).toEqual({
      message: "subject",
      all: true,
    });
  });

  test("a pull request is titled by the message's first line, then by the branch", () => {
    expect(pullRequestTitle("feat: a thing\n\nbody", tracking)).toBe("feat: a thing");
    expect(pullRequestTitle("   ", tracking)).toBe("main");
    expect(pullRequestTitle("", undefined)).toBe("");
  });
});

describe("what cannot apply", () => {
  test("an empty tree and an empty message stop every action that commits", () => {
    const empty = state({ fileCount: 0 });
    expect(commitActionDisabledReason("commit", empty)).toBe("Nothing to commit in this scope");
    expect(commitActionDisabledReason("branch-commit", empty)).toBe(
      "Nothing to commit in this scope",
    );
    // Pushing what is already committed still applies with nothing in the tree.
    expect(commitActionDisabledReason("push", empty)).toBeUndefined();
    expect(commitActionDisabledReason("commit", state({ message: "  " }))).toBe(
      "Write a commit message first",
    );
    expect(commitActionDisabledReason("push", state({ message: "" }))).toBeUndefined();
  });

  test("a detached HEAD has no branch to push or open a pull request from", () => {
    const detached = state({ branch: { ...tracking, detached: true, upstream: undefined } });
    expect(commitActionDisabledReason("push", detached)).toBe(
      "HEAD is detached, so there is no branch",
    );
    expect(commitActionDisabledReason("commit-push", detached)).toBe(
      "HEAD is detached, so there is no branch",
    );
    expect(commitActionDisabledReason("pull-request", detached)).toBe(
      "HEAD is detached, so there is no branch",
    );
    expect(commitActionDisabledReason("commit", detached)).toBeUndefined();
    // Creating a branch is how a detached HEAD gets one, so it stays available.
    expect(commitActionDisabledReason("branch-commit-push", detached)).toBeUndefined();
  });

  test("an unborn branch can be committed to, but has nothing to push yet", () => {
    const unborn = state({ branch: { ...tracking, unborn: true, upstream: undefined } });
    expect(commitActionDisabledReason("push", unborn)).toBe("This branch has no commits yet");
    expect(commitActionDisabledReason("commit-push", unborn)).toBeUndefined();
  });

  test("pull requests apply to the working tree only", () => {
    const commitScope = state({ scope: { kind: "commit", oid: "c0ffee0" } });
    expect(commitActionDisabledReason("pull-request", commitScope)).toBe(
      "Pull requests apply to the working tree",
    );
    expect(commitActionDisabledReason("commit-pull-request", commitScope)).toBe(
      "Pull requests apply to the working tree",
    );
    expect(isWorkingTreeScope({ kind: "unstaged" })).toBe(true);
    expect(isWorkingTreeScope({ kind: "turn", turnId: "turn-1" })).toBe(false);
  });
});

describe("what each outcome says", () => {
  test("a commit reports its oid, an empty tree, and git's own failure", () => {
    expect(
      commitResultMessage({
        kind: "committed",
        oid: "1234567890",
        shortOid: "1234567",
        summary: "fix a thing",
      }),
    ).toEqual({ tone: "success", text: "Committed 1234567: fix a thing" });
    expect(commitResultMessage({ kind: "nothing_to_commit" }).text).toBe(
      "Nothing to commit. The working tree matches the last commit.",
    );
    const failed = commitResultMessage({
      kind: "failed",
      reason: "pre-commit hook refused the commit",
    });
    expect(failed.tone).toBe("error");
    expect(failed.detail).toBe("pre-commit hook refused the commit");
  });

  test("a push offers publishing, asks for a pull, and never offers a force", () => {
    expect(pushResultMessage({ kind: "pushed", remote: "origin", branch: "main" })).toEqual({
      tone: "success",
      text: "Pushed main to origin.",
    });
    expect(pushResultMessage({ kind: "up_to_date" }).tone).toBe("success");
    const noUpstream = pushResultMessage({ kind: "no_upstream", branch: "feature" });
    expect(noUpstream.offerPublish).toBe(true);
    expect(noUpstream.text).toContain("feature tracks no remote branch yet");
    const rejected = pushResultMessage({ kind: "rejected", reason: "non-fast-forward" });
    expect(rejected.text).toBe(
      "The remote has commits this branch doesn’t. Pull them, then push again.",
    );
    expect(rejected.detail).toBe("non-fast-forward");
    for (const result of [noUpstream, rejected]) expect(result.text).not.toMatch(/force/i);
  });

  test("a branch reports a taken name and an invalid one without losing the reason", () => {
    expect(createBranchResultMessage({ kind: "created" }, "feature/x").tone).toBe("success");
    expect(createBranchResultMessage({ kind: "exists" }, "feature/x").text).toBe(
      "Branch feature/x already exists. Pick another name.",
    );
    const invalid = createBranchResultMessage(
      { kind: "invalid_name", reason: "is not a valid branch name" },
      "feature x",
    );
    expect(invalid.tone).toBe("error");
    expect(invalid.text).toContain("feature x is not a valid branch name");
    expect(invalid.detail).toBe("is not a valid branch name");
  });

  test("a pull request keeps its URL and names what GitHub is missing", () => {
    const created = pullRequestResultMessage({
      kind: "created",
      url: "https://github.com/nyte/nyte/pull/7",
    });
    expect(created.url).toBe("https://github.com/nyte/nyte/pull/7");
    const exists = pullRequestResultMessage({
      kind: "exists",
      pullRequest: {
        number: 7,
        title: "Add the commit bar",
        url: "https://github.com/nyte/nyte/pull/7",
        state: "OPEN",
        draft: false,
        headRefName: "feature",
        baseRefName: "main",
      },
    });
    expect(exists.text).toContain("#7 Add the commit bar");
    expect(exists.url).toBe("https://github.com/nyte/nyte/pull/7");
    expect(pullRequestResultMessage({ kind: "cli_missing" }).text).toBe(
      "Pull requests need the GitHub CLI. Install gh, then try again.",
    );
    expect(pullRequestResultMessage({ kind: "signed_out" }).text).toContain("gh auth login");
    expect(pullRequestResultMessage({ kind: "no_remote" }).text).toContain("no GitHub remote");
    expect(pullRequestResultMessage({ kind: "failed", message: "gh exited with 1" }).detail).toBe(
      "gh exited with 1",
    );
  });

  test("a trust refusal is about trust; any other failure keeps the host's words", () => {
    const refused = actionFailureMessage(
      bridgeError({ code: "forbidden", message: "Workspace trust is required." }),
    );
    expect(refused.tone).toBe("error");
    expect(refused.text).toContain("needs trust for this workspace");
    const other = actionFailureMessage(new Error("The host operation failed."));
    expect(other.detail).toBe("The host operation failed.");
  });
});
