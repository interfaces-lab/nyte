import type { WorkspaceTarget } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { Kernel } from "../contract/kernel.ts";
import { decodeTrustRecord } from "../contract/records.ts";
import type { TrustRecord, WorkspaceRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { commit } from "../fold/commit.ts";
import { kvRef, trustRef, trustTarget } from "../store/refs.ts";
import { load, put, readKv } from "../store/session.ts";
import { workspaceRecords } from "./environment.ts";

export const WORKSPACE_TRUST = "workspaceTrust";

type Trusted = Pick<WorkspaceRecord, "target" | "isolation">;

/**
 * Whether workspaces' project files may load, the way pi decides it: trust
 * belongs to a folder, not to a workspace registered there. A folder takes its
 * own decision, else the nearest folder above it with one, else the host's
 * `workspaceTrust` mode, where `ask` gives `null`. A worktree follows the
 * folder it was made from. The host's home folder holds the user's own files,
 * so it is never a project and never passes trust down.
 */
export interface FolderTrust {
  /** The decision saved for the folder `workspace` follows, or `null` when none is. */
  decided(workspace: Trusted): boolean | null;
  trusted(workspace: Trusted): boolean | null;
}

/**
 * Reads the saved decisions, the workspace records and the `workspaceTrust`
 * mode once; reuse the answer when resolving many workspaces.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function readFolderTrust(kernel: Kernel): Promise<FolderTrust> {
  const [records, decisions, mode] = await Promise.all([
    workspaceRecords(kernel.store),
    trustRecords(kernel.store),
    readKv(kernel.store, kvRef("host", "settings", WORKSPACE_TRUST)),
  ]);

  const home = kernel.home?.replace(/\/+$/u, "") ?? null;
  const fallback = mode === "always" ? true : mode === "never" ? false : null;

  const followed = (workspace: Trusted): WorkspaceTarget => {
    const source = workspace.isolation?.source;

    return trustTarget(
      records.find((record) => source !== undefined && record.id === source)?.target ??
        workspace.target,
    );
  };

  const decided = (target: WorkspaceTarget): boolean | null =>
    decisions.find((decision) => Value.Equal(decision.target, target))?.trusted ?? null;

  return {
    decided: (workspace) => decided(followed(workspace)),
    trusted(workspace) {
      const target = followed(workspace);

      if (!("path" in target)) return decided(target) ?? fallback;

      const { path } = target;

      if (path === home) return false;

      const nearest = decisions
        .flatMap(({ target: above, trusted }) =>
          "path" in above &&
          above.kind === target.kind &&
          above.path !== home &&
          (above.path === path || path.startsWith(`${above.path}/`))
            ? [{ depth: above.path.length, trusted }]
            : [],
        )
        .toSorted((a, b) => b.depth - a.depth)[0];

      return nearest?.trusted ?? fallback;
    },
  };
}

/**
 * Whether one workspace's project files may load; see {@link FolderTrust}.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function projectTrust(kernel: Kernel, workspace: Trusted): Promise<boolean | null> {
  const home = kernel.home?.replace(/\/+$/u, "") ?? null;
  const target = trustTarget(workspace.target);

  if (workspace.isolation === null && (!("path" in target) || target.path !== home)) {
    const own = await load(
      kernel.store,
      await kernel.store.refs.get(await trustRef(target)),
      decodeTrustRecord,
    );

    if (own !== null) return own.record.trusted;
  }

  return (await readFolderTrust(kernel)).trusted(workspace);
}

/** Saves the user's decision for the folder `workspace` follows: `null` forgets it. */
export async function decideTrust(
  kernel: Kernel,
  workspace: Trusted,
  trusted: boolean | null,
): Promise<void> {
  const source = workspace.isolation?.source;

  const target = trustTarget(
    (source === undefined
      ? undefined
      : (await workspaceRecords(kernel.store)).find((record) => record.id === source)?.target) ??
      workspace.target,
  );

  await commit(kernel, [
    {
      name: await trustRef(target),
      target:
        trusted === null
          ? null
          : await put(kernel.store, "trust", { target, trusted } satisfies TrustRecord),
    },
  ]);
}

async function trustRecords(store: StoreConnection): Promise<readonly TrustRecord[]> {
  const refs = await store.refs.list("trust/");
  const found = await Promise.all(refs.map((ref) => load(store, ref, decodeTrustRecord)));

  return found.flatMap((entry) => (entry === null ? [] : [entry.record]));
}
