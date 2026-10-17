import { expect, test } from "bun:test";
import { gitHubLines } from "../../src/lib/pull-request.ts";

const repository = {
  owner: "octo",
  name: "hello",
  remoteName: "origin",
  url: "https://github.com/octo/hello",
};

const ready = { kind: "ready", account: { login: "octocat" } } as const;

function plain(lines: ReturnType<typeof gitHubLines>): readonly string[] {
  return lines.map((line) =>
    typeof line === "string" ? line : line.map((span) => span.text).join(""),
  );
}

test("/pr says what stands in the way before there is a pull request to show", () => {
  expect(plain(gitHubLines(null))).toEqual(["This host doesn't serve GitHub"]);
  const unavailable = { repository, pullRequest: { kind: "unavailable" } } as const;

  expect(plain(gitHubLines({ account: { kind: "cli_missing" }, folder: unavailable }))).toEqual([
    "Install the GitHub CLI (gh) to open pull requests",
  ]);
  expect(plain(gitHubLines({ account: { kind: "signed_out" }, folder: unavailable }))).toEqual([
    "Sign in to the GitHub CLI to open pull requests",
    "Run gh auth login, then /pr",
  ]);
  expect(plain(gitHubLines({ account: ready, folder: { pullRequest: { kind: "none" } } }))).toEqual(
    ["This repository has no GitHub remote"],
  );
  expect(
    plain(gitHubLines({ account: ready, folder: { repository, pullRequest: { kind: "none" } } })),
  ).toEqual(["octo/hello", "No pull request for this branch"]);
});

test("/pr shows the branch's pull request and each check, failing first in the summary", () => {
  const lines = gitHubLines({
    account: ready,
    folder: {
      repository,
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
            { name: "test", state: "failed" },
            { name: "e2e", state: "pending" },
          ],
        },
      },
    },
  });

  expect(plain(lines)).toEqual([
    "octo/hello",
    "#12 Fix tab close · Open",
    "https://github.com/octo/hello/pull/12",
    "fix/tab-close → main",
    "",
    "1 failing, 1 pending, 1 passed",
    "✓ lint",
    "✗ test",
    "● e2e",
  ]);
});
