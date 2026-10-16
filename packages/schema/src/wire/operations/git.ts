import { Type } from "typebox";
import {
  BlameViewSchema,
  ChangeSetSchema,
  DiffOptionsType,
  GitCommitViewType,
  GitFileSidesSchema,
  GitOutcomeSchema,
  GitRefsViewSchema,
  GitScopeType,
  GitStatusSchema,
  GitWriteType,
  PatchSetWireSchema,
} from "../git.ts";
import { idSchema } from "../ids.ts";
import { pagedSchema } from "../primitives.ts";
import { ON_PATH, ON_WORKSPACE, PATH, wireObject, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const READ = { authority: "participant", scope: "workspace", capability: "git" } as const;

const WRITE = { authority: "owner", scope: "workspace", capability: "git" } as const;

const GIT_COMPARE = { ...WORKSPACE, scope: GitScopeType, options: Type.Optional(DiffOptionsType) };

const GIT_PATHS_INPUT = wireObject({
  ...WORKSPACE,
  paths: Type.Array(Type.String()),
  options: Type.Optional(GitWriteType),
});

const GIT_COMPARE_INPUT = wireObject(GIT_COMPARE);

export const GIT_OPERATIONS = {
  "git.status": { ...READ, kind: "query", input: ON_WORKSPACE, output: GitStatusSchema },
  "git.watch": { ...READ, kind: "watch", input: ON_WORKSPACE, output: GitStatusSchema },
  "git.changes": { ...READ, kind: "query", input: GIT_COMPARE_INPUT, output: ChangeSetSchema },
  "git.watchChanges": { ...READ, kind: "watch", input: GIT_COMPARE_INPUT, output: ChangeSetSchema },
  "git.patches": {
    ...READ,
    kind: "stream",
    input: wireObject({ ...GIT_COMPARE, paths: Type.Array(Type.String()) }),
    output: PatchSetWireSchema,
  },
  "git.contents": {
    ...READ,
    kind: "query",
    input: wireObject({ ...PATH, scope: GitScopeType }),
    output: GitFileSidesSchema,
  },
  "git.log": {
    ...READ,
    kind: "query",
    input: wireObject({
      ...WORKSPACE,
      cursor: Type.Optional(idSchema<"cursor">()),
      limit: Type.Optional(Type.Number()),
    }),
    output: pagedSchema(GitCommitViewType),
  },
  "git.refs": { ...READ, kind: "query", input: ON_WORKSPACE, output: GitRefsViewSchema },
  "git.blame": { ...READ, kind: "query", input: ON_PATH, output: BlameViewSchema },
  "git.stage": { ...WRITE, kind: "command", input: GIT_PATHS_INPUT, output: GitOutcomeSchema },
  "git.unstage": { ...WRITE, kind: "command", input: GIT_PATHS_INPUT, output: GitOutcomeSchema },
  "git.discard": { ...WRITE, kind: "command", input: GIT_PATHS_INPUT, output: GitOutcomeSchema },
  "git.commit": {
    ...WRITE,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Object({
        message: Type.String(),
        files: Type.Union([Type.Literal("staged"), Type.Literal("all"), Type.Array(Type.String())]),
      }),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
  "git.branch": {
    ...WRITE,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Object({ name: Type.String(), checkout: Type.Boolean() }),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
  "git.push": {
    ...WRITE,
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Optional(Type.Object({ setUpstream: Type.Optional(Type.Boolean()) })),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
} as const satisfies OperationRows;
