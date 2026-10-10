import type { SessionId } from "@nyte-ai/schema";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";

/** Returns raw store reads for one session: its refs, its reachable objects decoded 100 to a page, its log after a seq, and an integrity check. */
export function inspect(kernel: Kernel, session: SessionId): ReturnType<Host["inspect"]> {
  throw new Error("not implemented");
}
