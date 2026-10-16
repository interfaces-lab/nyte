import type { Authority } from "./declaration.ts";
import type { ValidationIssue } from "./errors.ts";
import type {
  CatalogGeneration,
  CommitId,
  Cursor,
  HeadName,
  ObjectId,
  PrincipalId,
  SessionId,
  WorkspaceId,
} from "./ids.ts";
import type { Json } from "./primitives.ts";

export type ExecutionCoverage =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionId[] };

export type AdvanceReport =
  | { readonly kind: "continue" }
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly until: number | null }
  | { readonly kind: "retry"; readonly until: number }
  | { readonly kind: "busy"; readonly until: number }
  | { readonly kind: "fenced" };

export type RepairPage = {
  readonly runnable: readonly { readonly session: SessionId; readonly head: HeadName }[];
  readonly next: Cursor | null;
};

export type PrincipalView = {
  readonly id: PrincipalId;
  readonly label: string;
  readonly authority: ReadonlySet<Authority>;
  readonly pairedAt: number;
};

export type PluginCheckReport = {
  readonly plugins: readonly PluginLoadOutcome[];
  readonly collisions: readonly ValidationIssue[];
};

export type PluginReplacementReport = {
  readonly generation: CatalogGeneration;
  readonly plugins: readonly PluginLoadOutcome[];
};

export type PluginLoadOutcome =
  | { readonly kind: "activated"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "rejected"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: "kept-previous";
      readonly id: string;
      readonly issues: readonly ValidationIssue[];
    };

export type DecodedObjectView = {
  readonly id: ObjectId;
  readonly kind: string;
  readonly parent: CommitId | null;
  readonly body: Json;
  readonly at: number;
};

export type IntegrityReport = {
  readonly ok: boolean;
  readonly issues: readonly {
    readonly ref: string | null;
    readonly object: CommitId | null;
    readonly message: string;
  }[];
};
