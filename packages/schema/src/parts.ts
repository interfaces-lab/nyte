import type { CallId, CommitId, PartId, RunId } from "./ids.ts";
import type { Failure } from "./model/message.ts";
import type { Json } from "./primitives.ts";
import type { WaitTarget } from "./runs.ts";
import type { ToolClass, ToolOutcome, ToolProgress } from "./tools.ts";

export type Placement =
  | { readonly kind: "transcript"; readonly role: "step" | "answer" | "note" }
  | { readonly kind: "modal" }
  | { readonly kind: string; readonly [detail: string]: Json };

export type PartStatus =
  | {
      readonly kind: "live";
      readonly run: RunId | null;
      readonly waiting?: CallId;
      readonly answer?: { readonly action: string; readonly input: Json };
    }
  | { readonly kind: "waiting"; readonly run: RunId; readonly on: WaitTarget }
  | { readonly kind: "settled"; readonly commit: CommitId; readonly endedAt: number }
  | { readonly kind: "failed"; readonly run: RunId | null; readonly failure: Failure };

export type PartView = {
  readonly id: PartId;
  readonly partKind: string;
  readonly placement: Placement;
  readonly state: Json;
  readonly version: number;
  readonly status: PartStatus;
  readonly owner: string | null;
};

export type ActOutcome<Output> =
  | { readonly kind: "ok"; readonly output: Output }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unknown-action" }
  | { readonly kind: "closed" }
  | { readonly kind: "no-owner" }
  | { readonly kind: "failed"; readonly message: string };

export type ToolPartState = {
  readonly call: CallId;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
} & (
  | { readonly phase: "calling" }
  | { readonly phase: "running"; readonly progress: ToolProgress | null }
  | {
      readonly phase: "settled";
      readonly outcome: ToolOutcome;
      readonly changes: {
        readonly added: number;
        readonly removed: number;
        readonly paths: readonly string[];
      } | null;
    }
);
