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
    kind: "query",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.signIn": {
    ...ACCOUNT_WRITE,
    kind: "command",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.signOut": {
    ...ACCOUNT_WRITE,
    kind: "command",
    input: NO_INPUT,
    output: GitHubAccountStateSchema,
  },
  "github.state": { ...READ, kind: "query", input: ON_WORKSPACE, output: GitHubStateSchema },
  "github.createPullRequest": {
    ...WRITE,
    kind: "command",
    input: wireObject({ ...WORKSPACE, input: GitHubPullRequestInputType }),
    output: GitHubPullRequestOutcomeSchema,
  },
} as const satisfies OperationRows;
