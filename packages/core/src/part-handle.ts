import type { HeadName, PartId, Placement, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { Part, PartDefinition } from "./parts.ts";
import type { ConnectionContext } from "./principals.ts";

/** Creates a part of a registered kind: validates `state` against the definition (`invalid` with issues), writes the `PartRecord` at `parts/<part>` with `part created` (owner from the registry, `run` default null), and returns its handle; an existing id with an equal state is a replay and writes nothing. A transcript part outside a run also lands as a commit on `head` (default main) in the same set. */
export function createPart(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  kind: PartDefinition,
  input: {
    readonly state: unknown;
    readonly placement: Placement;
    readonly id?: PartId;
    readonly run?: RunId | null;
    readonly head?: HeadName;
  },
): Promise<Part<PartDefinition>> {
  throw new Error("not implemented");
}

/** Returns a handle on a part by id: `update` validates and compare-and-sets the ref with `part updated`; `act` runs the definition's `onAction` as a durable step, or settles `answer()` when it has none; `answer()` waits in memory for the first act on a modal part, or null at close; `close` deletes the ref with `part closed`. Binds synchronously; no I/O. */
export function partHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
): Part<PartDefinition> {
  throw new Error("not implemented");
}
