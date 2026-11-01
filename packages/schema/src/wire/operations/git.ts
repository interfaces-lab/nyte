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
} from "../../git.ts";
import { idSchema } from "../../ids.ts";
import { pagedSchema } from "../../primitives.ts";
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
  "git.status": {
    ...READ,
    summary: "Reads the workspace's git status.",
    kind: "query",
    input: ON_WORKSPACE,
    output: GitStatusSchema,
  },
  "git.watch": {
    ...READ,
    summary: "Streams the workspace's git status each time it changes.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: GitStatusSchema,
  },
  "git.changes": {
    ...READ,
    summary: "Lists the files changed in a scope, such as the worktree, staged files or a commit.",
    kind: "query",
    input: GIT_COMPARE_INPUT,
    output: ChangeSetSchema,
  },
  "git.watchChanges": {
    ...READ,
    summary: "Streams the files changed in a scope each time they change.",
    kind: "watch",
    input: GIT_COMPARE_INPUT,
    output: ChangeSetSchema,
  },
  "git.patches": {
    ...READ,
    summary: "Streams the patches of the given files in a scope.",
    kind: "stream",
    input: wireObject({ ...GIT_COMPARE, paths: Type.Array(Type.String()) }),
    output: PatchSetWireSchema,
  },
  "git.contents": {
    ...READ,
    summary: "Reads a file's contents on both sides of a scope.",
    kind: "query",
    input: wireObject({ ...PATH, scope: GitScopeType }),
    output: GitFileSidesSchema,
  },
  "git.log": {
    ...READ,
    summary: "Lists commit history from a commit, or from HEAD, one page at a time.",
    kind: "query",
    input: wireObject({
      ...WORKSPACE,
      head: Type.Optional(idSchema<"git-commit">()),
      cursor: Type.Optional(idSchema<"cursor">()),
      limit: Type.Optional(Type.Number()),
    }),
    output: pagedSchema(GitCommitViewType),
  },
  "git.refs": {
    ...READ,
    summary: "Lists the workspace's branches, their upstreams and the current branch.",
    kind: "query",
    input: ON_WORKSPACE,
    output: GitRefsViewSchema,
  },
  "git.blame": {
    ...READ,
    summary: "Reads who last changed each line of a file.",
    kind: "query",
    input: ON_PATH,
    output: BlameViewSchema,
  },
  "git.stage": {
    ...WRITE,
    summary: "Stages the given files.",
    kind: "command",
    input: GIT_PATHS_INPUT,
    output: GitOutcomeSchema,
  },
  "git.unstage": {
    ...WRITE,
    summary: "Unstages the given files.",
    kind: "command",
    input: GIT_PATHS_INPUT,
    output: GitOutcomeSchema,
  },
  "git.discard": {
    ...WRITE,
    summary: "Discards local changes to the given files.",
    kind: "command",
    input: GIT_PATHS_INPUT,
    output: GitOutcomeSchema,
  },
  "git.commit": {
    ...WRITE,
    summary: "Commits staged files, all changes or the given files with a message.",
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
    summary: "Creates a branch and optionally checks it out; checkout fails while a run is live.",
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Object({ name: Type.String(), checkout: Type.Boolean() }),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
  "git.checkout": {
    ...WRITE,
    summary: "Checks out a branch; fails while a run is live or when local changes would be lost.",
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Object({ name: Type.String() }),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
  "git.push": {
    ...WRITE,
    summary: "Pushes the current branch, optionally setting its upstream.",
    kind: "command",
    input: wireObject({
      ...WORKSPACE,
      input: Type.Optional(Type.Object({ setUpstream: Type.Optional(Type.Boolean()) })),
      options: Type.Optional(GitWriteType),
    }),
    output: GitOutcomeSchema,
  },
} as const satisfies OperationRows;
