import {
  GitHubPullRequestInputType,
  GitHubPullRequestOutcomeSchema,
  GitHubStateSchema,
} from "../../github.ts";
import { ON_WORKSPACE, wireObject, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const READ = { authority: "participant", scope: "workspace", capability: "github" } as const;

const WRITE = { authority: "owner", scope: "workspace", capability: "github" } as const;

export const GITHUB_OPERATIONS = {
  "github.state": { ...READ, kind: "query", input: ON_WORKSPACE, output: GitHubStateSchema },
  "github.signIn": { ...WRITE, kind: "command", input: ON_WORKSPACE, output: GitHubStateSchema },
  "github.signOut": { ...WRITE, kind: "command", input: ON_WORKSPACE, output: GitHubStateSchema },
  "github.createPullRequest": {
    ...WRITE,
    kind: "command",
    input: wireObject({ ...WORKSPACE, input: GitHubPullRequestInputType }),
    output: GitHubPullRequestOutcomeSchema,
  },
} as const satisfies OperationRows;
