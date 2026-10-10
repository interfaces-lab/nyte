import type { HeadName, SessionId, TreeView } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Returns the session's commit DAG as rows for a head: every commit reachable from any head, parents first, siblings in creation order, the head's path active. */
export function tree(kernel: Kernel, session: SessionId, head: HeadName): Promise<TreeView> {
  throw new Error("not implemented");
}
