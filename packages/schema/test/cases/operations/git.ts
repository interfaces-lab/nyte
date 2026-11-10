import { OPERATIONS } from "../../../src/index.ts";
import {
  operation,
  workspace,
  gitCommit,
  gitRevision,
  cursor,
  workspaceInput,
  pathInput,
  gitCompare,
  gitPaths,
} from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const gitOperations = {
  "git.status input": operation(OPERATIONS["git.status"].input, workspaceInput, {}),
  "git.watch input": operation(OPERATIONS["git.watch"].input, workspaceInput, {}),
  "git.changes input": operation(OPERATIONS["git.changes"].input, gitCompare, { workspace }),
  "git.watchChanges input": operation(OPERATIONS["git.watchChanges"].input, gitCompare, {
    workspace,
    scope: {},
  }),
  "git.patches input": operation(
    OPERATIONS["git.patches"].input,
    { ...gitCompare, paths: ["a.ts"] },
    gitCompare,
  ),
  "git.contents input": operation(
    OPERATIONS["git.contents"].input,
    { ...pathInput, scope: { kind: "staged" } },
    pathInput,
  ),
  "git.log input": operation(
    OPERATIONS["git.log"].input,
    { workspace, head: gitCommit, cursor, limit: 20 },
    { workspace, limit: "20" },
  ),
  "git.log output": operation(
    OPERATIONS["git.log"].output,
    {
      items: [{ id: gitCommit, subject: "Fix", author: "A", committedAt: 1, parents: [] }],
      next: cursor,
    },
    { items: [], next: 1 },
  ),
  "git.refs input": operation(OPERATIONS["git.refs"].input, workspaceInput, {}),
  "git.blame input": operation(OPERATIONS["git.blame"].input, pathInput, { workspace }),
  "git.stage input": operation(OPERATIONS["git.stage"].input, gitPaths, { workspace }),
  "git.unstage input": operation(OPERATIONS["git.unstage"].input, gitPaths, {
    workspace,
    paths: [1],
  }),
  "git.discard input": operation(OPERATIONS["git.discard"].input, gitPaths, { paths: [] }),
  "git.commit input": operation(
    OPERATIONS["git.commit"].input,
    {
      workspace,
      input: { message: "Fix the parser.", files: ["a.ts"] },
      options: { expect: gitRevision },
    },
    { workspace, input: { message: "Fix.", files: "some" } },
  ),
  "git.branch input": operation(
    OPERATIONS["git.branch"].input,
    { workspace, input: { name: "fix", checkout: true } },
    { workspace, input: { name: "fix" } },
  ),
  "git.checkout input": operation(
    OPERATIONS["git.checkout"].input,
    { workspace, input: { name: "fix" }, options: { expect: gitRevision } },
    { workspace, input: { name: 1 } },
  ),
  "git.push input": operation(
    OPERATIONS["git.push"].input,
    { workspace, input: { setUpstream: true } },
    { workspace, input: { setUpstream: "yes" } },
  ),
} satisfies Record<string, Case>;
