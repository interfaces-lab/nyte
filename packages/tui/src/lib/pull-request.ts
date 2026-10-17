import type { GitHubCheck, GitHubPullRequest, GitHubState } from "@nyte-ai/sdk";
import type { TextLine, TextSpan } from "../model/dialogs/dialog.ts";
import { GLYPHS } from "./constants.ts";

type CheckState = GitHubCheck["state"];

/** The order a summary names the states in: what needs attention first. */
const SUMMARY_ORDER: readonly CheckState[] = ["failed", "pending", "passed", "skipped"];

const CHECK_MARKS = {
  failed: { mark: GLYPHS.cross, word: "failing", tone: "error" },
  pending: { mark: GLYPHS.bullet, word: "pending", tone: "warning" },
  passed: { mark: GLYPHS.check, word: "passed", tone: "accent" },
  skipped: { mark: "-", word: "skipped", tone: "dim" },
} as const satisfies Record<
  CheckState,
  { readonly mark: string; readonly word: string; readonly tone: TextSpan["tone"] }
>;

const STATE_WORDS = { OPEN: "Open", CLOSED: "Closed", MERGED: "Merged" } as const;

function checksLine(checks: readonly GitHubCheck[]): TextLine {
  if (checks.length === 0) return [{ text: "No checks", tone: "muted" }];

  if (checks.every((check) => check.state === "passed"))
    return checks.length === 1 ? "1 check passed" : `All ${String(checks.length)} checks passed`;

  return SUMMARY_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;

    return count === 0 ? [] : [`${String(count)} ${CHECK_MARKS[state].word}`];
  }).join(", ");
}

function pullRequestLines(pullRequest: GitHubPullRequest): readonly TextLine[] {
  const state = pullRequest.draft ? "Draft" : STATE_WORDS[pullRequest.state];

  return [
    [
      { text: `#${String(pullRequest.number)} ${pullRequest.title}`, bold: true },
      { text: ` · ${state}`, tone: "muted" },
    ],
    [{ text: pullRequest.url, tone: "accent" }],
    [{ text: `${pullRequest.headRefName} → ${pullRequest.baseRefName}`, tone: "muted" }],
    "",
    checksLine(pullRequest.checks),
    ...pullRequest.checks.map((check): TextLine => {
      const { mark, tone } = CHECK_MARKS[check.state];

      return [{ text: `${mark} `, tone }, { text: check.name }];
    }),
  ];
}

/** What `/pr` shows: the branch's pull request and its checks, or the GitHub state that stands in the way; `null` where the host serves no GitHub. */
export function gitHubLines(state: GitHubState | null): readonly TextLine[] {
  if (state === null) return ["This host doesn't serve GitHub"];

  switch (state.kind) {
    case "cli_missing":
      return ["Install the GitHub CLI (gh) to open pull requests"];
    case "signed_out":
      return ["Sign in to the GitHub CLI to open pull requests", "Run gh auth login, then /pr"];
    case "signing_in":
      return [
        "Waiting for approval on github.com",
        `Enter ${state.deviceCode.userCode} at ${state.deviceCode.verificationUri}`,
      ];
    case "error":
      return [[{ text: state.message, tone: "error" }]];
    case "ready":
      break;
  }

  const { repository, pullRequest } = state;

  if (repository === undefined) return ["This repository has no GitHub remote"];
  const named: TextLine = [{ text: `${repository.owner}/${repository.name}`, tone: "muted" }];

  if (pullRequest.kind === "none") return [named, "No pull request for this branch"];

  if (pullRequest.kind === "error") return [named, [{ text: pullRequest.message, tone: "error" }]];

  return [named, ...pullRequestLines(pullRequest.pullRequest)];
}
