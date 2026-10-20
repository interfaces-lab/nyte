import { expect, test } from "bun:test";
import { chatOnly } from "@nyte-ai/bench";
import type { GitHubAccountState, GitHubApi, GitHubState, Plugin } from "@nyte-ai/sdk";
import { openTestHost } from "../fixture/host.ts";
import { belowComposer, startTui } from "../harness/tui.ts";

const READY: GitHubState = {
  repository: {
    owner: "octo",
    name: "hello",
    remoteName: "origin",
    url: "https://github.com/octo/hello",
  },
  pullRequest: {
    kind: "ready",
    pullRequest: {
      number: 12,
      title: "Fix tab close",
      url: "https://github.com/octo/hello/pull/12",
      state: "OPEN",
      draft: false,
      headRefName: "fix/tab-close",
      baseRefName: "main",
      checks: [
        { name: "lint", state: "passed" },
        { name: "unit tests", state: "failed" },
        { name: "e2e", state: "pending" },
      ],
    },
  },
};

const refuse = async (): Promise<never> => {
  throw new Error("Not scripted.");
};

function gitHubEnvironment(state: () => GitHubState): Plugin<"core"> {
  const base = chatOnly.environment;

  if (base === undefined) throw new Error("chatOnly provides no environment.");

  const api: GitHubApi = { state: async () => state(), createPullRequest: refuse };

  return { id: "github-environment", environment: { ...base, github: () => api } };
}

test("/pr shows the chat folder's pull request and its checks from the host, and the machine's login when it blocks", async () => {
  let account: GitHubAccountState = { kind: "signed_out" };
  let state: GitHubState = { pullRequest: { kind: "unavailable" } };

  const fixture = await openTestHost({
    environment: gitHubEnvironment(() => state),
    github: { account: async () => account, signIn: refuse, signOut: refuse },
  });

  await using tui = await startTui({ fixture });
  await tui.ready();

  await tui.send("/pr");
  await tui.frame(
    (frame) =>
      belowComposer(frame, "Pull request") &&
      frame.includes("Sign in to the GitHub CLI to open pull requests"),
  );
  tui.press("picker.close");
  await tui.frame((frame) => !belowComposer(frame, "Pull request"));

  account = { kind: "ready", account: { login: "octocat" } };
  state = READY;
  await tui.send("/pr status");
  const shown = await tui.frame((frame) => frame.includes("#12 Fix tab close"));

  expect(shown).toContain("1 failing, 1 pending, 1 passed");
  expect(shown).toContain("✗ unit tests");
  expect(shown).toContain("https://github.com/octo/hello/pull/12");
  expect(tui.fixture.requests).toHaveLength(0);
});
