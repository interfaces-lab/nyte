import type { CallId, CommitId, PartId, RunId } from "./ids.ts";
import type { Failure } from "./model/message.ts";
import type { Json } from "./primitives.ts";
import type { WaitTarget } from "./runs.ts";
import type { ToolClass, ToolOutcome, ToolProgress } from "./tools.ts";

/**
 * Names where a part is shown.
 *
 * **Details**
 *
 * Placement is open on purpose. Core types only what it acts on:
 *
 * - `transcript`: core makes it a message; the commit references the part,
 *   so it stays live.
 * - `modal`: core blocks `answer()` and `wait({ kind: "part" })` until an
 *   action settles it.
 * - anything else: core stores it, lists it in `view.parts`, and has no
 *   opinion. "panel", "status", "sidebar/weather", an org's own kind. The
 *   client that knows it draws it; one that doesn't ignores it.
 *
 * @category parts
 * @since 0.1.0
 */
export type Placement =
  | { readonly kind: "transcript"; readonly role: "step" | "answer" | "note" }
  | { readonly kind: "modal" }
  | { readonly kind: string; readonly [detail: string]: Json };

/**
 * Returns a part message's lifecycle.
 *
 * **Details**
 *
 * - `live`: being written: streaming text, a running tool, an open modal.
 *   `run` is null for a part created outside a run (a modal a client opened).
 *   `waiting` is the durable step parked on a modal's answer, which `act`
 *   writes the answer to; `answer` is an answer that came before any step
 *   parked, which the first step to wait on the part takes (§48i).
 * - `waiting`: parked on a durable wait.
 * - `settled`: committed.
 * - `failed`: its run failed or was stopped; `run` null when closed by a
 *   failure outside a run.
 *
 * @category views
 * @since 0.1.0
 */
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

/** Returns one part outside the transcript, with its placement as given. */
export type PartView = {
  readonly id: PartId;
  readonly partKind: string;
  readonly placement: Placement;
  readonly state: Json;
  readonly version: number;
  readonly status: PartStatus;
  readonly owner: string | null;
};

/**
 * Returns the result of calling a part action.
 *
 * **Outcomes**
 *
 * - `ok`: `output` is the action's return value.
 * - `rejected`: `onAction` threw a domain refusal; `reason` says why.
 * - `unknown-action`: the definition has no such action.
 * - `closed`: the part was closed first.
 * - `no-owner`: the definition has an `onAction` but the plugin that supplied it unloaded; the part stays readable.
 * - `failed`: `onAction` threw; `message` says what.
 *
 * @category parts
 * @since 0.1.0
 */
export type ActOutcome<Output> =
  | { readonly kind: "ok"; readonly output: Output }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unknown-action" }
  | { readonly kind: "closed" }
  | { readonly kind: "no-owner" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Returns the state of a tool part: the call, its class, progress, outcome
 * and file changes.
 *
 * @category parts
 * @since 0.1.0
 */
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
