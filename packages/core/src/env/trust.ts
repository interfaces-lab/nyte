import type { Kernel } from "../contract/kernel.ts";
import type { WorkspaceRecord } from "../contract/records.ts";
import { kvRef } from "../store/refs.ts";
import { readKv } from "../store/session.ts";
import { workspaceRecords } from "./environment.ts";

export const WORKSPACE_TRUST = "workspaceTrust";

/**
 * Decides whether a workspace's project files may load, the way pi does:
 * the folder's own decision, else the nearest registered parent folder's
 * decision, else the host's `workspaceTrust` mode, where `ask` gives `null`.
 * The host's home folder holds the user's own files, so it is never a
 * project and never passes trust down.
 */
export type TrustResolver = (
  record: Pick<WorkspaceRecord, "target" | "projectResources">,
) => boolean | null;

/**
 * Reads the workspace records and the `workspaceTrust` mode once and returns
 * a {@link TrustResolver} over them; reuse it when resolving many workspaces.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function readTrustResolver(kernel: Kernel): Promise<TrustResolver> {
  const [records, mode] = await Promise.all([
    workspaceRecords(kernel),
    readKv(kernel, kvRef("host", "settings", WORKSPACE_TRUST)),
  ]);

  const home = kernel.home?.replace(/\/+$/u, "") ?? null;

  const folder = (target: WorkspaceRecord["target"]): string | null =>
    "path" in target ? target.path.replace(/\/+$/u, "") : null;

  const fallback = mode === "always" ? true : mode === "never" ? false : null;

  return (record) => {
    const path = folder(record.target);

    if (path !== null && path === home) return false;

    if (record.projectResources !== null) return record.projectResources;

    if (path === null) return fallback;

    const parent = records
      .flatMap((other) => {
        const above = folder(other.target);

        return other.target.kind === record.target.kind &&
          other.projectResources !== null &&
          above !== null &&
          above !== home &&
          path.startsWith(`${above}/`)
          ? [{ depth: above.length, trusted: other.projectResources }]
          : [];
      })
      .toSorted((a, b) => b.depth - a.depth)[0];

    return parent?.trusted ?? fallback;
  };
}

/**
 * Whether one workspace's project files may load; see {@link TrustResolver}.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function projectTrust(
  kernel: Kernel,
  record: Pick<WorkspaceRecord, "target" | "projectResources">,
): Promise<boolean | null> {
  const home = kernel.home?.replace(/\/+$/u, "") ?? null;
  const path = "path" in record.target ? record.target.path.replace(/\/+$/u, "") : null;

  if (record.projectResources !== null && (path === null || path !== home))
    return record.projectResources;

  return (await readTrustResolver(kernel))(record);
}
