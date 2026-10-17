import { Type } from "typebox";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

/** The GitHub repository a workspace's remote names: its owner, name, the remote it was read from, and its canonical `https://github.com/<owner>/<name>` URL. Remote credentials and raw remote URLs never cross. */
export const GitHubRepositoryType = Type.Object({
  owner: Type.String(),
  name: Type.String(),
  remoteName: Type.String(),
  url: Type.String(),
});

export type GitHubRepository = Decoded<typeof GitHubRepositoryType>;

/** The account the serving machine's `gh` is signed in as on github.com. */
export const GitHubAccountType = Type.Object({
  login: Type.String(),
  name: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String()),
});

export type GitHubAccount = Decoded<typeof GitHubAccountType>;

/** One CI check on a pull request's head commit: a check run or a commit status, folded to the four states a reader acts on. */
export const GitHubCheckType = Type.Object({
  name: Type.String(),
  state: Type.Enum(["pending", "passed", "failed", "skipped"]),
  url: Type.Optional(Type.String()),
});

export type GitHubCheck = Decoded<typeof GitHubCheckType>;

/** The pull request for a workspace's checked-out branch, with the checks on its head commit. */
export const GitHubPullRequestType = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  url: Type.String(),
  state: Type.Enum(["OPEN", "CLOSED", "MERGED"]),
  draft: Type.Boolean(),
  headRefName: Type.String(),
  baseRefName: Type.String(),
  checks: Type.Array(GitHubCheckType),
});

export type GitHubPullRequest = Decoded<typeof GitHubPullRequestType>;

/** Whether the checked-out branch has a pull request: `none` also for a detached HEAD or a folder without a GitHub remote, `unavailable` while the machine's `gh` has no account that can read it (see `github.account`). */
export const GitHubPullRequestContextType = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("unavailable") }),
  Type.Object({ kind: Type.Literal("ready"), pullRequest: GitHubPullRequestType }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
]);

export type GitHubPullRequestContext = Decoded<typeof GitHubPullRequestContextType>;

/** The one-time code `gh auth login` printed and the github.com page it is entered at; it lasts until the sign-in ends. */
export const GitHubDeviceCodeType = Type.Object({
  userCode: Type.String(),
  verificationUri: Type.String(),
  expiresInSeconds: Type.Optional(Type.Number()),
});

export type GitHubDeviceCode = Decoded<typeof GitHubDeviceCodeType>;

/** The serving machine's `gh` login, one for the whole machine: `cli_missing` when no `gh` is on the PATH, `signed_out` with no github.com account, `signing_in` while a sign-in waits for its code, `ready` with the account, `error` with what to do next. */
export const GitHubAccountStateType = Type.Union([
  Type.Object({ kind: Type.Literal("cli_missing") }),
  Type.Object({ kind: Type.Literal("signed_out") }),
  Type.Object({ kind: Type.Literal("signing_in"), deviceCode: GitHubDeviceCodeType }),
  Type.Object({ kind: Type.Literal("ready"), account: GitHubAccountType }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
]);

export type GitHubAccountState = Decoded<typeof GitHubAccountStateType>;

/** A workspace on GitHub: the repository its remotes name, absent where none names github.com, and the checked-out branch's pull request. */
export const GitHubStateType = Type.Object({
  repository: Type.Optional(GitHubRepositoryType),
  pullRequest: GitHubPullRequestContextType,
});

export type GitHubState = Decoded<typeof GitHubStateType>;

/** What opening a pull request takes. Without a title `gh` fills the title and body from the branch's commits. */
export const GitHubPullRequestInputType = Type.Object({
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  draft: Type.Optional(Type.Boolean()),
});

export type GitHubPullRequestInput = Decoded<typeof GitHubPullRequestInputType>;

/** How opening a pull request ended: `created` with the new one, `exists` with the open one for the branch, or the precondition that stopped it. */
export const GitHubPullRequestOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("created"), url: Type.String() }),
  Type.Object({ kind: Type.Literal("exists"), pullRequest: GitHubPullRequestType }),
  Type.Object({ kind: Type.Literal("cli_missing") }),
  Type.Object({ kind: Type.Literal("signed_out") }),
  Type.Object({ kind: Type.Literal("no_remote") }),
  Type.Object({ kind: Type.Literal("detached") }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

export type GitHubPullRequestOutcome = Decoded<typeof GitHubPullRequestOutcomeType>;

export const GitHubStateSchema: Schema<GitHubState> = standard(GitHubStateType);

export const GitHubAccountStateSchema: Schema<GitHubAccountState> =
  standard(GitHubAccountStateType);

export const GitHubPullRequestOutcomeSchema: Schema<GitHubPullRequestOutcome> = standard(
  GitHubPullRequestOutcomeType,
);
