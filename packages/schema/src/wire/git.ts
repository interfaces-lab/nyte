import { Type } from "typebox";
import type { TProperties } from "typebox";
import type {
  BlameView,
  ChangeSet,
  DiffOptions,
  GitCommitView,
  GitFileSide,
  GitFileSides,
  GitOutcome,
  GitRefsView,
  GitScope,
  GitStatus,
  GitWrite,
  Hunk,
  LineStat,
  PatchEntry,
  PatchSet,
} from "../git.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { FileChangeType, FileStatusType } from "./files.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

/** Returns the wire form of a `PatchSet`: its entries as a JSON object keyed by path; the sdk rebuilds the map. */
export type PatchSetWire = Omit<PatchSet, "entries"> & {
  readonly entries: Readonly<Record<string, PatchEntry & { readonly fresh: boolean }>>;
};

const REVISION = Type.Union([idSchema<"git-revision">(), idSchema<"snapshot">()]);

/** The TypeBox schema of a `GitStatus`. */
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

/** The TypeBox schema of a `GitCommitView`. */
export const GitCommitViewType = Type.Object({
  id: idSchema<"git-commit">(),
  subject: Type.String(),
  author: Type.String(),
  committedAt: Type.Number(),
  parents: Type.Array(idSchema<"git-commit">()),
});

/** The TypeBox schema of a `GitRefsView`. */
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

/** The TypeBox schema of a `GitFileSide`. */
export const GitFileSideType = Type.Union([
  Type.Object({ kind: Type.Literal("absent") }),
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({ kind: Type.Literal("truncated"), head: Type.String() }),
  Type.Object({ kind: Type.Literal("binary") }),
]);

/** The TypeBox schema of `GitFileSides`. */
export const GitFileSidesType = Type.Object({
  path: Type.String(),
  old: GitFileSideType,
  new: GitFileSideType,
});

/** The TypeBox schema of a `BlameView`. */
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

/** The TypeBox schema of a `GitScope`. */
export const GitScopeType = Type.Union([
  Type.Object({ kind: Type.Literal("worktree") }),
  Type.Object({ kind: Type.Literal("staged") }),
  Type.Object({ kind: Type.Literal("unstaged") }),
  Type.Object({ kind: Type.Literal("commit"), commit: idSchema<"git-commit">() }),
  Type.Object({ kind: Type.Literal("branch"), base: Type.String() }),
]);

/** The TypeBox schema of `DiffOptions`. */
export const DiffOptionsType = Type.Object({ ignoreWhitespace: Type.Optional(Type.Boolean()) });

/** The TypeBox schema of a `LineStat`. */
export const LineStatType = Type.Union([
  Type.Object({ kind: Type.Literal("text"), added: Type.Number(), removed: Type.Number() }),
  Type.Object({ kind: Type.Literal("binary") }),
  Type.Object({ kind: Type.Literal("unknown") }),
]);

/** The TypeBox schema of a `ChangeSet`. */
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

/** The TypeBox schema of a `Hunk`. */
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

/** The TypeBox schema of a `PatchEntry`. */
export const PatchEntryType = patchEntry({});

/** The TypeBox schema of a `PatchSetWire`. */
export const PatchSetWireType = Type.Object({
  revision: REVISION,
  entries: Type.Record(Type.String(), patchEntry({ fresh: Type.Boolean() })),
});

/** The TypeBox schema of a `GitWrite`. */
export const GitWriteType = Type.Object({ expect: Type.Optional(idSchema<"git-revision">()) });

/** The TypeBox schema of a `GitOutcome`. */
export const GitOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("applied"), revision: idSchema<"git-revision">() }),
  Type.Object({ kind: Type.Literal("unchanged") }),
  Type.Object({ kind: Type.Literal("stale"), revision: idSchema<"git-revision">() }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("rejected"), reason: Type.String() }),
]);

/** Validates a `GitStatus`. */
export const GitStatusSchema: Schema<GitStatus> = standard(GitStatusType);

/** Validates a `GitCommitView`. */
export const GitCommitViewSchema: Schema<GitCommitView> = standard(GitCommitViewType);

/** Validates a `GitRefsView`. */
export const GitRefsViewSchema: Schema<GitRefsView> = standard(GitRefsViewType);

/** Validates a `GitFileSide`. */
export const GitFileSideSchema: Schema<GitFileSide> = standard(GitFileSideType);

/** Validates `GitFileSides`. */
export const GitFileSidesSchema: Schema<GitFileSides> = standard(GitFileSidesType);

/** Validates a `BlameView`. */
export const BlameViewSchema: Schema<BlameView> = standard(BlameViewType);

/** Validates a `GitScope`. */
export const GitScopeSchema: Schema<GitScope> = standard(GitScopeType);

/** Validates `DiffOptions`. */
export const DiffOptionsSchema: Schema<DiffOptions> = standard(DiffOptionsType);

/** Validates a `LineStat`. */
export const LineStatSchema: Schema<LineStat> = standard(LineStatType);

/** Validates a `ChangeSet`. */
export const ChangeSetSchema: Schema<ChangeSet> = standard(ChangeSetType);

/** Validates a `Hunk`. */
export const HunkSchema: Schema<Hunk> = standard(HunkType);

/** Validates a `PatchEntry`. */
export const PatchEntrySchema: Schema<PatchEntry> = standard(PatchEntryType);

/** Validates a `PatchSetWire`. */
export const PatchSetWireSchema: Schema<PatchSetWire> = standard(PatchSetWireType);

/** Validates a `GitWrite`. */
export const GitWriteSchema: Schema<GitWrite> = standard(GitWriteType);

/** Validates a `GitOutcome`. */
export const GitOutcomeSchema: Schema<GitOutcome> = standard(GitOutcomeType);
