import type { Configuration, ConfigurationPatch } from "./configuration.ts";
import type { ValidationIssue } from "./errors.ts";
import type { CommitId, HeadName, MessageId, ReceiptId, Revision, RunId } from "./ids.ts";
import type { Delivery, MessageSource, Position, UserContent } from "./messages.ts";
import type { ModelRef } from "./models.ts";

export type TreeView = {
  readonly revision: Revision | null;
  readonly tip: Position;
  readonly nodes: readonly TreeNode[];
};

export type TreeNode = {
  readonly id: CommitId;
  readonly parent: CommitId | null;
  readonly depth: number;
  readonly branch: boolean;
  readonly active: boolean;
  readonly heads: readonly HeadName[];
  readonly kind: "user" | "part" | "compaction" | "branchSummary";
  readonly partKind: string | null;
  readonly preview: string;
  readonly at: number;
  readonly run: RunId | null;
};

export type CreateHeadOutcome =
  | { readonly kind: "created"; readonly basedOn: Position }
  | { readonly kind: "exists" }
  | { readonly kind: "missing-source" };

export type MergeOutcome =
  | { readonly kind: "merged"; readonly revision: Revision }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "diverged"; readonly base: Position }
  | { readonly kind: "is-main" }
  | { readonly kind: "busy"; readonly run: RunId };

export type RemoveHeadOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "missing" }
  | { readonly kind: "is-main" }
  | { readonly kind: "busy"; readonly run: RunId };

export type MoveOutcome =
  | {
      readonly kind: "moved";
      readonly revision: Revision;
      readonly position: Position;
      readonly summary: MessageId | null;
      readonly handback: UserContent | null;
    }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "busy"; readonly run: RunId }
  | { readonly kind: "pending-input"; readonly messages: readonly MessageId[] }
  | { readonly kind: "missing-target" }
  | { readonly kind: "summary-failed"; readonly reason: string };

export type MoveOptions = {
  readonly running?: "refuse" | "stop";
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  readonly expect?: Revision;
};

export type SendOptions = {
  readonly delivery?: Delivery;
  readonly replace?: MessageId;
  readonly running?: "refuse" | "stop";
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  readonly expect?: Revision;
  readonly position?:
    | { readonly kind: "last" }
    | { readonly kind: "before"; readonly message: MessageId };
  readonly source?: MessageSource;
  readonly configuration?: Configuration | ConfigurationPatch;
  readonly id?: ReceiptId;
};

export type ConfigureOutcome =
  | { readonly kind: "configured"; readonly selected: Configuration; readonly revision: Revision }
  | { readonly kind: "unknown-model"; readonly model: ModelRef }
  | { readonly kind: "unknown-agent"; readonly agent: string }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };
