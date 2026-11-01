import {
  GitHubAccountStateSchema,
  GitHubPullRequestInputType,
  GitHubPullRequestOutcomeSchema,
  GitHubStateSchema,
} from "../../github.ts";
import { ON_WORKSPACE, wireObject, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const READ = { authority: "participant", scope: "workspace", capability: "github" } as const;

const WRITE = { authority: "owner", scope: "workspace", capability: "github" } as const;

const ACCOUNT = { authority: "participant", scope: "host" } as const;

const ACCOUNT_WRITE = { authority: "owner", scope: "host" } as const;

const NO_INPUT = wireObject({});

export const GITHUB_OPERATIONS = {
  "github.account": {
    ...ACCOUNT,
    summary: "Reads the GitHub account the host machine is signed in as.",
    kind: "query",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.signIn": {
    ...ACCOUNT_WRITE,
    summary: "Starts a GitHub sign-in on the host machine and returns its one-time code.",
    kind: "command",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.signOut": {
    ...ACCOUNT_WRITE,
    summary:
      "Signs the host machine out of GitHub, or cancels a sign-in still waiting for its code.",
    kind: "command",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.state": {
    ...READ,
    summary: "Reads the workspace's repository and the pull request for its branch, with checks.",
    kind: "query",
    input: ON_WORKSPACE,
    output: GitHubStateSchema,
  },
  "github.createPullRequest": {
    ...WRITE,
    summary: "Opens a pull request for the workspace's pushed branch unless one is already open.",
    kind: "command",
    input: wireObject({ ...WORKSPACE, input: GitHubPullRequestInputType }),
    output: GitHubPullRequestOutcomeSchema,
  },
} as const satisfies OperationRows;
