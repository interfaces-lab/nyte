import type { Configuration } from "./configuration.ts";
import type { FileChange } from "./files.ts";
import type { CommitId, MessageId, PartId, Revision, RunId, Seq, TurnId } from "./ids.ts";
import type { Delivery, MessageSource, Schedule, UserContent } from "./messages.ts";
import type { ContextView } from "./models.ts";
import type { PartStatus, PartView } from "./parts.ts";
import type { BackgroundItem, Execution, RunEnd, WaitTarget } from "./runs.ts";
import type { HeadInfo, SessionCatalogView } from "./sessions.ts";
import type { ToolClass } from "./tools.ts";
import type { Activation } from "./workspaces.ts";

export type ViewOptions = {
  readonly tail?: number;
};

export type SessionView = {
  readonly revision: Revision | null;
  readonly seq: Seq;

  readonly activation: Activation;
  readonly messages: readonly Message[];
  readonly parts: readonly PartView[];
  readonly turns: readonly TurnInfo[];
  readonly execution: Execution;
  readonly background: readonly BackgroundItem[];
  readonly configuration: {
    readonly selected: Configuration | null;
    readonly effective: Configuration | null;
  };
  readonly context: ContextView;
  readonly heads: readonly HeadInfo[];
  readonly changes: readonly FileChange[];
  readonly catalog: SessionCatalogView;
};

export type Message = { readonly id: MessageId; readonly turn: TurnId; readonly at: number } & (
  | {
      readonly kind: "user";
      readonly content: UserContent;
      readonly source: MessageSource;
      readonly delivery: Delivery;
      readonly status: UserStatus;
      readonly siblings: {
        readonly index: number;
        readonly count: number;
        readonly ids: readonly CommitId[];
      };
    }
  | {
      readonly kind: "part";
      readonly part: PartId;
      readonly partKind: string;
      readonly role: "step" | "answer" | "note";
      readonly state: unknown;
      readonly version: number;
      readonly status: PartStatus;
    }
);

export type UserStatus =
  | {
      readonly kind: "unsent";
      readonly attempts: number;
      readonly retrying: { readonly at: number; readonly reason: string } | null;
    }
  | { readonly kind: "pending"; readonly schedule: Schedule; readonly covered: boolean }
  | {
      readonly kind: "landed";
      readonly commit: CommitId;
      readonly run: RunId | null;
      readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
    };

export type TurnInfo = {
  readonly id: TurnId;
  readonly run: RunId | null;
  readonly prompt: MessageId | null;
  readonly state:
    | { readonly kind: "working"; readonly activity: string | null }
    | { readonly kind: "waiting"; readonly on: WaitTarget }
    | { readonly kind: "ended"; readonly end: RunEnd };
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly steps: number;
  readonly thinkingOnly: boolean;
  readonly summary: {
    readonly byClass: Readonly<
      Record<ToolClass["kind"], { readonly count: number; readonly paths: readonly string[] }>
    >;
    readonly failed: number;
    readonly stopped: number;
    readonly added: number;
    readonly removed: number;
  };
};

/** One array of a view as the previous frame's array spliced: `runs` holds `[from, count]` pairs, each copying `count` items of the previous array from `from`, or with `from` -1 taking the next `count` of `items`. */
export type ViewSplice<T> = { readonly runs: readonly number[]; readonly items: readonly T[] };

/** Text a streaming part streamed since the previous frame: the message at `at` of the spliced messages, its `state.markdown` grown by `append`, now at `version`. */
export type ViewAppend = { readonly at: number; readonly append: string; readonly version: number };

/** One frame of a head's watch on the wire: the whole view first, then each later view as what changed since the frame before it, an absent field unchanged. */
export type ViewFrame =
  | { readonly kind: "view"; readonly view: SessionView }
  | {
      readonly kind: "delta";
      readonly seq: Seq;
      readonly revision?: Revision | null;
      readonly activation?: Activation;
      readonly messages?: ViewSplice<Message>;
      readonly appends?: readonly ViewAppend[];
      readonly parts?: ViewSplice<PartView>;
      readonly turns?: ViewSplice<TurnInfo>;
      readonly execution?: Execution;
      readonly background?: ViewSplice<BackgroundItem>;
      readonly configuration?: SessionView["configuration"];
      readonly context?: ContextView;
      readonly heads?: ViewSplice<HeadInfo>;
      readonly changes?: ViewSplice<FileChange>;
      readonly catalog?: SessionCatalogView;
    };
