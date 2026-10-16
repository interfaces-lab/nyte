import type { Configuration } from "./configuration.ts";
import type { CallId, HeadName, JobId, MessageId, PartId, RunId, SessionId } from "./ids.ts";
import type { JobEnd } from "./jobs.ts";
import type { Failure } from "./model/message.ts";
import type { Usage } from "./models.ts";
import type { Json } from "./primitives.ts";

export type RunView = {
  readonly id: RunId;
  readonly head: HeadName;
  readonly startedAt: number;
  readonly attempt: number;
  readonly configuration: Configuration;
  readonly origin:
    | { readonly kind: "input"; readonly message: MessageId }
    | { readonly kind: "continuation"; readonly from: "child" | "job" | "wake" };
};

export type RunEnd =
  | { readonly kind: "completed"; readonly usage: Usage }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly failure: Failure };

export type Execution =
  | {
      readonly kind: "idle";
      readonly lastRun: {
        readonly id: RunId;
        readonly end: RunEnd;
        readonly endedAt: number;
      } | null;
    }
  | {
      readonly kind: "live";
      readonly run: RunView;
      readonly phase: "responding" | "executing";
      readonly stopping: boolean;
    }
  | { readonly kind: "waiting"; readonly run: RunView; readonly on: WaitTarget }
  | {
      readonly kind: "retrying";
      readonly run: RunView;
      readonly until: number;
      readonly reason: string;
    };

export type BackgroundItem = {
  readonly kind: "child" | "job" | "page";
  readonly id: string;
  readonly title: string;
  readonly state: "working" | "waiting" | "done" | "failed";
  readonly startedBy: CallId | null;
};

export type WaitTarget = { readonly deadline?: number } & (
  | { readonly kind: "run"; readonly session: SessionId; readonly run: RunId }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "timer"; readonly until: number }
);

export type StopOutcome<O> =
  | { readonly kind: "requested" }
  | { readonly kind: "settled"; readonly outcome: O }
  | { readonly kind: "missing" };

export type WaitOutcome =
  | { readonly kind: "run"; readonly session: SessionId; readonly run: RunId; readonly end: RunEnd }
  | { readonly kind: "job"; readonly job: JobId; readonly end: JobEnd }
  | {
      readonly kind: "part";
      readonly part: PartId;
      readonly answer: { readonly action: string; readonly input: Json } | null;
    }
  | { readonly kind: "timer" }
  | { readonly kind: "deadline" }
  | { readonly kind: "input"; readonly message: MessageId }
  | { readonly kind: "all"; readonly outcomes: readonly WaitOutcome[] }
  | { readonly kind: "stopped" };
