import type { HeadName, MoveOptions, MoveOutcome, Position, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { Receipt } from "./receipt.ts";

/** Moves a head to a position as a durable command and returns its receipt: guards, an optional stop, an optional branch summary, then one set with `head moved`. */
export function move(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  options?: MoveOptions,
): Promise<Receipt<MoveOutcome>> {
  throw new Error("not implemented");
}
