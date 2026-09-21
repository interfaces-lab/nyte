/**
 * The commit surface's rules that are not covered by its renderer fixture.
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
  commitActionDisabledReason,
  commitTargetFor,
  commitResultMessage,
  createBranchResultMessage,
  isWorkingTreeScope,
  pullRequestResultMessage,
  pullRequestTitle,
} from "./changes-commit-bar.tsx";
import type { CommitBarState } from "./changes-commit-bar.tsx";
import type { BranchReadout } from "./change-scopes.ts";

const tracking: BranchReadout = {
  kind: "attached",
  label: "main",
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
  test("a staged scope commits the index; every other working scope commits tracked changes", () => {
    expect(commitTargetFor({ kind: "staged" })).toEqual({ kind: "staged" });
    expect(commitTargetFor({ kind: "uncommitted" })).toEqual({ kind: "all" });
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
    const detached = state({ branch: { kind: "detached", label: "c0ffee0" } });
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
    const unborn = state({ branch: { kind: "unborn", label: "main" } });
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
  test("a commit failure keeps git's own words", () => {
    const failed = commitResultMessage({
      kind: "failed",
      reason: "pre-commit hook refused the commit",
    });
    expect(failed.tone).toBe("error");
    expect(failed.detail).toBe("pre-commit hook refused the commit");
  });

  test("an invalid branch name keeps git's reason", () => {
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
    expect(pullRequestResultMessage({ kind: "signed_out" }).text).toContain("gh auth login");
    expect(pullRequestResultMessage({ kind: "no_remote" }).text).toContain("no GitHub remote");
    expect(pullRequestResultMessage({ kind: "failed", message: "gh exited with 1" }).detail).toBe(
      "gh exited with 1",
    );
  });

  test("an unexpected failure keeps the host's words", () => {
    const failure = actionFailureMessage(new Error("The host operation failed."));
    expect(failure.detail).toBe("The host operation failed.");
  });
});
