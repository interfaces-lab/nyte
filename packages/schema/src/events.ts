import type { Configuration } from "./configuration.ts";
import type { FileChange } from "./files.ts";
import type {
  CallId,
  CommitId,
  HeadName,
  MessageId,
  PartId,
  PrincipalId,
  RunId,
  Seq,
} from "./ids.ts";
import type { Delivery, MessageSource, Schedule, UserContent } from "./messages.ts";
import type { Failure } from "./model/message.ts";
import type { ContextView, Usage } from "./models.ts";
import type { Placement } from "./parts.ts";
import type { Json } from "./primitives.ts";
import type { BackgroundItem, RunEnd, RunView, WaitTarget } from "./runs.ts";
import type { SessionCatalogView, SessionInfo } from "./sessions.ts";
import type { ToolClass, ToolOutcome, ToolProgress } from "./tools.ts";
import type { Activation } from "./workspaces.ts";

export type SessionEvent = { readonly seq: Seq; readonly at: number } & DurableEvent;

export type DurableEvent = { readonly head: HeadName | null } & (
  | {
      readonly kind: "commit";
      readonly id: CommitId;
      readonly parent: CommitId | null;
      readonly run: RunId | null;
      readonly body: CommitBody;
    }
  | {
      readonly kind: "head";
      readonly from: CommitId | null;
      readonly to: CommitId | null;
      readonly reason: "moved" | "merged" | "created" | "removed";
    }
  | { readonly kind: "seen"; readonly principal: PrincipalId; readonly commit: CommitId | null }
  | ({ readonly kind: "input"; readonly message: MessageId } & (
      | {
          readonly change: "admitted";
          readonly content: UserContent;
          readonly source: MessageSource;
          readonly delivery: Delivery;
          readonly schedule: Schedule;
          readonly covered: boolean;
          readonly configuration: Configuration;
          readonly replaced: {
            readonly previous: MessageId;
            readonly stopped: RunId | null;
          } | null;
        }
      | { readonly change: "scheduled"; readonly schedule: Schedule; readonly position: number }
      | { readonly change: "landed"; readonly commit: CommitId; readonly run: RunId | null }
      | { readonly change: "withdrawn" }
      | { readonly change: "superseded"; readonly by: MessageId }
    ))
  | ({ readonly kind: "run"; readonly run: RunId } & (
      | { readonly change: "started"; readonly view: RunView }
      | { readonly change: "phase"; readonly phase: "responding" | "executing" }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | {
          readonly change: "retrying";
          readonly attempt: number;
          readonly until: number;
          readonly reason: string;
        }
      | { readonly change: "stopping" }
      | { readonly change: "ended"; readonly end: RunEnd }
    ))
  | ({ readonly kind: "part"; readonly part: PartId } & (
      | {
          readonly change: "created";
          readonly partKind: string;
          readonly placement: Placement;
          readonly state: Json;
          readonly version: number;
          readonly run: RunId | null;
          readonly owner: string | null;
        }
      | { readonly change: "updated"; readonly state: Json; readonly version: number }
      | { readonly change: "waiting"; readonly call: CallId }
      | { readonly change: "settled"; readonly commit: CommitId; readonly endedAt: number }
      | { readonly change: "failed"; readonly failure: Failure }
      | {
          readonly change: "answered";
          readonly answer: { readonly action: string; readonly input: Json };
        }
      | { readonly change: "closed" }
    ))
  | ({ readonly kind: "call"; readonly call: CallId; readonly part: PartId } & (
      | {
          readonly change: "intent";
          readonly name: string;
          readonly args: Json;
          readonly class: ToolClass;
        }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | {
          readonly change: "settled";
          readonly outcome: ToolOutcome;
          readonly changes: {
            readonly added: number;
            readonly removed: number;
            readonly paths: readonly string[];
          } | null;
        }
    ))
  | { readonly kind: "background"; readonly item: BackgroundItem }
  | {
      readonly kind: "configured";
      readonly selected: Configuration | null;
      readonly effective: Configuration | null;
    }
  | {
      readonly kind: "request";
      readonly usage: Usage;
      readonly context: ContextView;
      readonly step: "assistant" | "compaction" | "summary" | "plugin";
    }
  | { readonly kind: "changes"; readonly files: readonly FileChange[] }
  | { readonly kind: "session"; readonly info: SessionInfo }
  | { readonly kind: "activation"; readonly activation: Activation }
  | { readonly kind: "catalog"; readonly catalog: SessionCatalogView }
);

export type PatchEvent = { readonly kind: "patch"; readonly part: PartId } & (
  | { readonly append: string }
  | { readonly markdown: string }
  | { readonly progress: ToolProgress }
);

export type CommitBody =
  | {
      readonly kind: "user";
      readonly message: MessageId;
      readonly content: UserContent;
      readonly source: MessageSource;
      readonly delivery: Delivery;
      readonly siblings: readonly CommitId[];
    }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "compaction"; readonly part: PartId; readonly replaces: readonly CommitId[] }
  | {
      readonly kind: "branchSummary";
      readonly part: PartId;
      readonly replaces: readonly CommitId[];
    };
