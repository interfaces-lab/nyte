import { asId, SdkError } from "@nyte-ai/schema";
import type { PrincipalId, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { WorkspaceRecord } from "../contract/records.ts";
import { commit } from "../fold/commit.ts";
import { workspaceRef } from "../store/refs.ts";
import { attempt, put, STALE } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { dev } from "../util/dev-log.ts";
import { readWorkspace, workspaceRecords } from "./environment.ts";
import { byIdentity, changed, sessionsOn } from "./workspaces.ts";

/**
 * Answers the workspace that isolates `session` in a git worktree of `source`,
 * making it on the first call: the provider checks a new branch out with the
 * source's uncommitted changes, and the folder is registered with an
 * `isolation` naming the session, so it follows the source's trust. A later call for the session,
 * as a replayed start makes, answers the same workspace and makes nothing.
 */
export async function isolateWorkspace(
  kernel: Kernel,
  principal: PrincipalId,
  input: {
    readonly source: WorkspaceId;
    readonly session: SessionId;
    readonly title: string | null;
  },
): Promise<WorkspaceId> {
  const records = await workspaceRecords(kernel.store);
  const made = records.find((record) => record.isolation?.session === input.session);

  if (made !== undefined) return made.id;
  const source = records.find((record) => record.id === input.source);

  if (source === undefined)
    throw new SdkError("unknown", `Workspace ${input.source} is not registered on this host.`);
  const worktrees = kernel.environments.provider(source.target.kind)?.worktrees;

  if (worktrees === undefined)
    throw new SdkError(
      "unavailable",
      `A ${source.target.kind} workspace has no git worktrees, so this chat cannot run in one.`,
    );

  const worktree = await worktrees.create(await kernel.environments.attachWorkspace(source.id), {
    name: input.session,
    title: input.title,
  });

  const provider = kernel.environments.provider(worktree.target.kind);

  if (provider === undefined)
    throw new SdkError("unavailable", `No environment provider serves ${worktree.target.kind}.`);
  const inspected = await provider.inspect(worktree.target);
  const identity = { kind: worktree.target.kind, identity: inspected.identity };
  const id = asId<"workspace">(await objectId(identity));

  return attempt<WorkspaceId>(`Registering the worktree for ${input.session}`, async () => {
    const existing = await byIdentity(kernel.store, identity);

    if (existing !== null) return existing.id;

    const record: WorkspaceRecord = {
      id,
      target: worktree.target,
      identity: inspected.identity,
      projectSources: inspected.projectSources,
      addedBy: principal,
      createdAt: Date.now(),
      isolation: {
        kind: "worktree",
        source: source.id,
        session: input.session,
        branch: worktree.branch,
        base: worktree.base,
      },
    };

    const outcome = await commit(kernel, [
      {
        name: workspaceRef(id),
        target: await put(kernel.store, "workspace", record),
        expect: "absent",
      },
    ]);

    if (outcome.kind === "stale") return STALE;
    changed(kernel, id);

    return id;
  });
}

/** How old a worktree's workspace must be before a sweep releases it for having no chat, so a start still registering its chat (in another process over the same store) keeps its worktree. */
const ORPHAN_MS = 60_000;

/**
 * Removes the worktree that isolated `session` once no chat is left on it,
 * then forgets its workspace. The provider keeps a folder that holds
 * uncommitted changes and a branch with commits; a kept folder, or a removal
 * that fails, keeps its workspace too, so the folder stays listed under its
 * source and the next sweep tries again.
 */
export async function releaseWorktree(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
): Promise<void> {
  const record = await readWorkspace(kernel.store, workspace);
  const isolation = record?.isolation;

  if (record === null || isolation === null || isolation === undefined) return;

  if (isolation.session !== session || (await sessionsOn(kernel.store, workspace)).length > 0)
    return;
  await kernel.environments.detachWorkspace(workspace);

  const removal = await kernel.environments
    .provider(record.target.kind)
    ?.worktrees?.remove({ target: record.target, branch: isolation.branch, base: isolation.base })
    .catch((error: unknown) => {
      dev("worktrees", "remove failed", { session, workspace, error: String(error) });

      return null;
    });

  dev("worktrees", "removed", { session, workspace, ...removal });

  if (removal === null || removal?.folder === "kept") return;

  await attempt(`Forgetting the worktree of ${session}`, async () => {
    const ref = await kernel.store.refs.get(workspaceRef(workspace));

    if (ref === null) return true;
    const outcome = await commit(kernel, [
      { name: workspaceRef(workspace), target: null, expect: ref.revision },
    ]);

    return outcome.kind === "stale" ? STALE : true;
  });
  changed(kernel, workspace);
}

/**
 * Releases every worktree no chat is on: one whose chat was removed before
 * its release committed, as a crash leaves it, or moved to another workspace.
 * Converges: a folder kept for its changes is tried again on the next sweep.
 * A worktree younger than a minute is left to the start registering it.
 */
export async function sweepWorktrees(kernel: Kernel): Promise<void> {
  const now = Date.now();

  for (const record of await workspaceRecords(kernel.store)) {
    const session = record.isolation?.session;

    if (session === undefined || now - record.createdAt < ORPHAN_MS) continue;
    await releaseWorktree(kernel, session, record.id);
  }
}
