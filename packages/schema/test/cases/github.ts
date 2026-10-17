import {
  GitHubAccountStateSchema,
  GitHubPullRequestOutcomeSchema,
  GitHubStateSchema,
} from "../../src/index.ts";
import { sample } from "./fixtures.ts";
import type { Case } from "./fixtures.ts";

const repository = {
  owner: "octo",
  name: "hello",
  remoteName: "origin",
  url: "https://github.com/octo/hello",
};

const pullRequest = {
  number: 12,
  title: "Fix tab close",
  url: "https://github.com/octo/hello/pull/12",
  state: "OPEN",
  draft: false,
  headRefName: "feature",
  baseRefName: "main",
  checks: [
    { name: "lint", state: "passed", url: "https://github.com/octo/hello/actions/runs/1" },
    { name: "e2e", state: "pending" },
  ],
} as const;

export const githubCases = {
  GitHubStateSchema: sample(
    GitHubStateSchema,
    { repository, pullRequest: { kind: "ready", pullRequest } },
    { repository, pullRequest: { kind: "open" } },
  ),
  GitHubAccountStateSchema: sample(
    GitHubAccountStateSchema,
    { kind: "ready", account: { login: "octocat", name: "The Octocat" } },
    { kind: "ready", repository },
  ),
  GitHubPullRequestOutcomeSchema: sample(
    GitHubPullRequestOutcomeSchema,
    { kind: "exists", pullRequest },
    { kind: "exists", pullRequest: { ...pullRequest, checks: [{ name: "x", state: "green" }] } },
  ),
} satisfies Record<string, Case>;
