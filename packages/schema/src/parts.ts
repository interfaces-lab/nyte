import type { CommitId, PartId, RunId } from "./ids.ts";
import type { Failure } from "./model/message.ts";
import type { Json } from "./primitives.ts";
import type { WaitTarget } from "./runs.ts";

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
 * - `waiting`: parked on a durable wait.
 * - `settled`: committed.
 * - `failed`: its run failed or was stopped.
 *
 * @category views
 * @since 0.1.0
 */
export type PartStatus =
  | { readonly kind: "live"; readonly run: RunId }
  | { readonly kind: "waiting"; readonly run: RunId; readonly on: WaitTarget }
  | { readonly kind: "settled"; readonly commit: CommitId; readonly endedAt: number }
  | { readonly kind: "failed"; readonly run: RunId; readonly failure: Failure };

/** Returns one part outside the transcript, with its placement as given. */
export interface PartView { readonly id: PartId; readonly partKind: string; readonly placement: Placement; readonly state: Json; readonly version: number; readonly status: PartStatus; readonly owner: string | null }
