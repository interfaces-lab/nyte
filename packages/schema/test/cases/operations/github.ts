import { OPERATIONS } from "../../../src/index.ts";
import { operation, workspace, workspaceInput } from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const githubOperations = {
  "github.state input": operation(OPERATIONS["github.state"].input, workspaceInput, {}),
  "github.repository output": operation(
    OPERATIONS["github.repository"].output,
    { owner: "octo", name: "hello", remoteName: "origin", url: "https://github.com/octo/hello" },
    { owner: "octo" },
  ),
  "github.account input": operation(OPERATIONS["github.account"].input, {}, 1),
  "github.signIn input": operation(OPERATIONS["github.signIn"].input, {}, 1),
  "github.signOut input": operation(OPERATIONS["github.signOut"].input, {}, 1),
  "github.createPullRequest input": operation(
    OPERATIONS["github.createPullRequest"].input,
    { workspace, input: { title: "Fix", body: "Why.", draft: true } },
    { workspace, input: { title: 1 } },
  ),
} satisfies Record<string, Case>;
