import { SdkError } from "@nyte-ai/schema";
import type { FolderTrust, WorkspaceTarget } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { Kernel } from "../contract/kernel.ts";
import { decodeTrustRecord } from "../contract/records.ts";
import type { TrustRecord, WorkspaceRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { commit } from "../watch/commit.ts";
import { kvRef, trustRef, trustTarget } from "../store/refs.ts";
import { load, put, readKv, workspaceRecords } from "../store/session.ts";

export const WORKSPACE_TRUST = "workspaceTrust";

type Trusted = Pick<WorkspaceRecord, "target" | "isolation">;

export interface TrustDecisions {
  explain(workspace: Trusted, sources: readonly string[]): FolderTrust;
}

export async function readTrustDecisions(kernel: Kernel): Promise<TrustDecisions> {
  const [records, decisions, mode] = await Promise.all([
    workspaceRecords(kernel.store),
    trustRecords(kernel.store),
    readKv(kernel.store, kvRef("host", "settings", WORKSPACE_TRUST)),
  ]);

  const home = kernel.home?.replace(/\/+$/u, "") ?? null;

  const followed = (workspace: Trusted): WorkspaceTarget => {
    const source = workspace.isolation?.source;

    return trustTarget(
      records.find((record) => source !== undefined && record.id === source)?.target ??
        workspace.target,
    );
  };

  const saved = (target: WorkspaceTarget) => {
    if (!("path" in target)) {
      const exact = decisions.find((decision) => Value.Equal(decision.target, target));

      return exact === undefined ? null : { path: null, trusted: exact.trusted };
    }

    return (
      decisions
        .flatMap(({ target: above, trusted }) =>
          "path" in above &&
          above.kind === target.kind &&
          above.path !== home &&
          (above.path === target.path || target.path.startsWith(`${above.path}/`))
            ? [{ path: above.path, trusted }]
            : [],
        )
        .toSorted((a, b) => b.path.length - a.path.length)[0] ?? null
    );
  };

  return {
    explain(workspace, sources) {
      const target = followed(workspace);

      if ("path" in target && target.path === home) return { state: "home" };
      const decision = saved(target);
      const skipped = sources.length > 0 ? "tell" : null;
      const parent = folderAbove(target, home);

      if (decision !== null) {
        const by = { kind: "folder", path: decision.path } as const;

        return decision.trusted
          ? { state: "trusted", by }
          : { state: "untrusted", by, notice: skipped, parent };
      }

      if (mode === "always") return { state: "trusted", by: { kind: "setting" } };

      if (mode === "never") {
        return { state: "untrusted", by: { kind: "setting" }, notice: skipped, parent };
      }

      return { state: "undecided", notice: sources.length > 0 ? "ask" : null, parent };
    },
  };
}

export async function projectTrust(kernel: Kernel, workspace: Trusted): Promise<boolean> {
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

  return (await readTrustDecisions(kernel)).explain(workspace, []).state === "trusted";
}

export async function decideTrust(
  kernel: Kernel,
  workspace: Trusted,
  trusted: boolean | null,
  at: "folder" | "parent" = "folder",
): Promise<void> {
  const source = workspace.isolation?.source;

  const own = trustTarget(
    (source === undefined
      ? undefined
      : (await workspaceRecords(kernel.store)).find((record) => record.id === source)?.target) ??
      workspace.target,
  );

  const target = at === "folder" ? own : parentTarget(own, kernel);

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

function parentTarget(own: WorkspaceTarget, kernel: Kernel): WorkspaceTarget {
  const above = folderAbove(own, kernel.home?.replace(/\/+$/u, "") ?? null);

  if (above === null || !("path" in own)) {
    throw new SdkError("invalid", "This folder has no folder above it whose trust would cover it.");
  }

  return { ...own, path: above };
}

function folderAbove(target: WorkspaceTarget, home: string | null): string | null {
  if (!("path" in target)) return null;
  const path = target.path.replace(/\/+$/u, "");
  const cut = path.lastIndexOf("/");

  if (cut <= 0) return null;
  const above = path.slice(0, cut);

  return above === home ? null : above;
}

async function trustRecords(store: StoreConnection): Promise<readonly TrustRecord[]> {
  const refs = await store.refs.list("trust/");
  const found = await Promise.all(refs.map((ref) => load(store, ref, decodeTrustRecord)));

  return found.flatMap((entry) => (entry === null ? [] : [entry.record]));
}
