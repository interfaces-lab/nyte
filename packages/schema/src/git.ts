import { Type } from "typebox";
import type { TProperties } from "typebox";
import { FileChangeType, FileStatusType } from "./files.ts";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

const REVISION = Type.Union([idSchema<"git-revision">(), idSchema<"snapshot">()]);

export const GitStatusType = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({
    kind: Type.Literal("repository"),
    root: Type.String(),
    head: nullable(idSchema<"git-commit">()),
    branch: nullable(Type.String()),
    upstream: nullable(
      Type.Object({ name: Type.String(), ahead: Type.Number(), behind: Type.Number() }),
    ),
    revision: idSchema<"git-revision">(),
    staged: Type.Array(FileChangeType),
    unstaged: Type.Array(FileChangeType),
    untracked: Type.Array(Type.String()),
    conflicts: Type.Array(Type.String()),
  }),
]);

export type GitStatus = Decoded<typeof GitStatusType>;

export const GitCommitViewType = Type.Object({
  id: idSchema<"git-commit">(),
  subject: Type.String(),
  author: Type.String(),
  committedAt: Type.Number(),
  parents: Type.Array(idSchema<"git-commit">()),
});

export type GitCommitView = Decoded<typeof GitCommitViewType>;

export const GitRefsViewType = Type.Object({
  current: nullable(Type.String()),
  branches: Type.Array(
    Type.Object({
      name: Type.String(),
      commit: idSchema<"git-commit">(),
      upstream: nullable(Type.String()),
    }),
  ),
  remotes: Type.Array(Type.String()),
});

export type GitRefsView = Decoded<typeof GitRefsViewType>;

export const GitFileSideType = Type.Union([
  Type.Object({ kind: Type.Literal("absent") }),
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({ kind: Type.Literal("truncated"), head: Type.String() }),
  Type.Object({ kind: Type.Literal("binary") }),
]);

export type GitFileSide = Decoded<typeof GitFileSideType>;

export const GitFileSidesType = Type.Object({
  path: Type.String(),
  old: GitFileSideType,
  new: GitFileSideType,
});

export type GitFileSides = Decoded<typeof GitFileSidesType>;

export const BlameViewType = Type.Object({
  path: Type.String(),
  lines: Type.Array(
    Type.Object({
      line: Type.Number(),
      commit: idSchema<"git-commit">(),
      author: Type.String(),
      at: Type.Number(),
    }),
  ),
});

export type BlameView = Decoded<typeof BlameViewType>;

export const GitScopeType = Type.Union([
  Type.Object({ kind: Type.Literal("worktree") }),
  Type.Object({ kind: Type.Literal("staged") }),
  Type.Object({ kind: Type.Literal("unstaged") }),
  Type.Object({ kind: Type.Literal("commit"), commit: idSchema<"git-commit">() }),
  Type.Object({ kind: Type.Literal("branch"), base: Type.String() }),
]);

export type GitScope = Decoded<typeof GitScopeType>;

export const DiffOptionsType = Type.Object({ ignoreWhitespace: Type.Optional(Type.Boolean()) });

export type DiffOptions = Decoded<typeof DiffOptionsType>;

export const LineStatType = Type.Union([
  Type.Object({ kind: Type.Literal("text"), added: Type.Number(), removed: Type.Number() }),
  Type.Object({ kind: Type.Literal("binary") }),
  Type.Object({ kind: Type.Literal("unknown") }),
]);

export type LineStat = Decoded<typeof LineStatType>;

export const ChangeSetType = Type.Object({
  revision: REVISION,
  files: Type.Array(
    Type.Object({
      path: Type.String(),
      status: FileStatusType,
      stat: LineStatType,
      from: Type.Optional(Type.String()),
    }),
  ),
});

export type ChangeSet = Decoded<typeof ChangeSetType>;

export const HunkType = Type.Object({
  oldStart: Type.Number(),
  oldLines: Type.Number(),
  newStart: Type.Number(),
  newLines: Type.Number(),
  header: nullable(Type.String()),
  lines: Type.Array(
    Type.Object({
      kind: Type.Enum(["context", "add", "remove"]),
      text: Type.String(),
      noNewline: Type.Optional(Type.Literal(true)),
    }),
  ),
});

export type Hunk = Decoded<typeof HunkType>;

function patchEntry<Extra extends TProperties>(extra: Extra) {
  const common = { path: Type.String(), status: FileStatusType, digest: Type.String(), ...extra };

  return Type.Union([
    Type.Object({
      ...common,
      kind: Type.Literal("text"),
      added: Type.Number(),
      removed: Type.Number(),
      hunks: Type.Array(HunkType),
    }),
    Type.Object({ ...common, kind: Type.Literal("binary") }),
    Type.Object({ ...common, kind: Type.Literal("empty") }),
    Type.Object({ ...common, kind: Type.Literal("too-large"), limit: Type.Number() }),
    Type.Object({ ...common, kind: Type.Literal("failed"), reason: Type.String() }),
  ]);
}

export const PatchEntryType = patchEntry({});

export type PatchEntry = Decoded<typeof PatchEntryType>;

export const PatchSetWireType = Type.Object({
  revision: REVISION,
  entries: Type.Record(Type.String(), patchEntry({ fresh: Type.Boolean() })),
});

export type PatchSetWire = Decoded<typeof PatchSetWireType>;

export const GitWriteType = Type.Object({ expect: Type.Optional(idSchema<"git-revision">()) });

export type GitWrite = Decoded<typeof GitWriteType>;

export const GitOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("applied"), revision: idSchema<"git-revision">() }),
  Type.Object({ kind: Type.Literal("unchanged") }),
  Type.Object({ kind: Type.Literal("stale"), revision: idSchema<"git-revision">() }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("rejected"), reason: Type.String() }),
]);

export type GitOutcome = Decoded<typeof GitOutcomeType>;

export const GitStatusSchema: Schema<GitStatus> = standard(GitStatusType);

export const GitCommitViewSchema: Schema<GitCommitView> = standard(GitCommitViewType);

export const GitRefsViewSchema: Schema<GitRefsView> = standard(GitRefsViewType);

export const GitFileSideSchema: Schema<GitFileSide> = standard(GitFileSideType);

export const GitFileSidesSchema: Schema<GitFileSides> = standard(GitFileSidesType);

export const BlameViewSchema: Schema<BlameView> = standard(BlameViewType);

export const GitScopeSchema: Schema<GitScope> = standard(GitScopeType);

export const DiffOptionsSchema: Schema<DiffOptions> = standard(DiffOptionsType);

export const LineStatSchema: Schema<LineStat> = standard(LineStatType);

export const ChangeSetSchema: Schema<ChangeSet> = standard(ChangeSetType);

export const HunkSchema: Schema<Hunk> = standard(HunkType);

export const PatchEntrySchema: Schema<PatchEntry> = standard(PatchEntryType);

export const PatchSetWireSchema: Schema<PatchSetWire> = standard(PatchSetWireType);

export const GitWriteSchema: Schema<GitWrite> = standard(GitWriteType);

export const GitOutcomeSchema: Schema<GitOutcome> = standard(GitOutcomeType);

/** A patch set as the client holds it: the wire entries keyed in a map. */
export type PatchSet = Omit<PatchSetWire, "entries"> & {
  readonly entries: ReadonlyMap<string, PatchSetWire["entries"][string]>;
};
