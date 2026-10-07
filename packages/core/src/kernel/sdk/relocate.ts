/**
 * Moving an idle session tree to another workspace, opened as any workspace
 * opens: every head and job of the root and its descendants must be quiet, the
 * head leases are held through plugin activation, and only then is the root's
 * workspace replaced.
 */
import { isTerminalPhase } from "@nyte-ai/protocol";
import { landsNow } from "../admission.ts";
import { withLeaseRenewal } from "../lease.ts";
import type { Run } from "../model.ts";
import { WORKSPACE_REF, headRef } from "../names.ts";
import { pending } from "../queue.ts";
import type { Session } from "../store.ts";
import { activate } from "./activation.ts";
import { JOB_PREFIX } from "./jobs.ts";
import type { Runners } from "./runner.ts";
import { actsIn, type Pooled, type SessionPool } from "./session-pool.ts";
import type { Delegation } from "./delegation.ts";
import {
  sessionId,
  type HeadName,
  type NyteOptions,
  type RelocateOutcome,
  type SessionId,
  type Workspace,
} from "./types.ts";

export function createRelocation(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly runners: Runners;
  readonly delegation: Pick<Delegation, "jobsFor" | "pluginsFor">;
}) {
  const { options, pool, runners } = input;
  const { jobsFor, pluginsFor } = input.delegation;
  const drain = options.drain ?? "one";

  /** Queued work the runner would land now. A completion waiting for user input is not. */
  const queuedWork = async (
    session: Session,
    head: HeadName,
    run: Run | undefined,
  ): Promise<boolean> => landsNow(session, run, await pending(session, head), drain);

  const sessionWorkspace = async (input: { readonly sessionId: SessionId }): Promise<Workspace> =>
    pool.storedWorkspace(await pool.open(input.sessionId));

  const sessionCwd = async (input: {
    readonly sessionId: SessionId;
  }): Promise<string | undefined> => {
    const state = await pool.resolveSessionActivation(
      input.sessionId,
      await pool.open(input.sessionId),
    );

    return state.kind === "active" && pool.served(state.env) ? state.env.cwd : undefined;
  };

  const relocate = async (input: {
    readonly sessionId: SessionId;
    readonly workspace: Workspace;
  }): Promise<RelocateOutcome> => {
    const pooled = await pool.rootOf(await pool.open(input.sessionId));
    const id = sessionId(pooled.session.id);

    if (pooled.relocating) return { kind: "busy" };
    // Stop new local drives before the first await. Existing work is rejected, never aborted.
    pooled.relocating = true;
    const related: [SessionId, Pooled][] = [[id, pooled]];

    try {
      await pooled.reconciliation;
      await pooled.opening;
      await pooled.resolving;
      await pool.resolveSessionActivation(id, pooled);
      const expect = await pooled.session.refs.read(WORKSPACE_REF);
      const destination = await pool.openWorkspace(input.workspace);

      if (destination.kind === "failed") return { kind: "failed", error: destination.error };

      if (destination.kind !== "active") return destination;

      const restoring =
        actsIn(await pool.storedWorkspace(pooled), input.workspace) &&
        pooled.activationState?.kind !== "active";

      const sessions = new Map<SessionId, Pooled>();

      for (const stored of await options.store.list()) {
        const entryId = sessionId(stored.id);
        sessions.set(entryId, await pool.open(entryId));
      }

      const inTree = (entry: Pooled, seen = new Set<string>()): boolean => {
        if (entry.parent === undefined || seen.has(entry.session.id)) return false;

        if (entry.parent.sessionId === id) return true;
        seen.add(entry.session.id);
        const above = sessions.get(entry.parent.sessionId);

        return above !== undefined && inTree(above, seen);
      };

      for (const [entryId, entry] of sessions) {
        if (inTree(entry)) related.push([entryId, entry]);
      }

      /** Live job work, or a job lease another owner still holds, blocks the move. */
      const jobsBusy = async (sessionId: SessionId, entry: Pooled): Promise<boolean> => {
        for (const job of await jobsFor(sessionId, entry).list()) {
          if (!restoring && job.phase.kind === "running") return true;

          if ((await entry.session.leases.read(JOB_PREFIX + job.id)) !== undefined) return true;
        }

        return false;
      };

      const heads: { session: Session; head: HeadName }[] = [];

      for (const [sessionId, entry] of related) {
        if ([...(entry.drives?.values() ?? [])].some((state) => state.running)) {
          return { kind: "busy" };
        }

        for (const head of await pool.listSessionHeads(entry.session)) {
          heads.push({ session: entry.session, head: head.head });
          const run = await pool.readRun(entry.session, head.head);

          if (
            (!restoring && run !== undefined && !isTerminalPhase(run.run.phase)) ||
            (await entry.session.leases.read(headRef(head.head))) !== undefined ||
            (!restoring && (await queuedWork(entry.session, head.head, run?.run)))
          )
            return { kind: "busy" };
        }

        if (await jobsBusy(sessionId, entry)) return { kind: "busy" };
      }

      const replace = async (signal: AbortSignal): Promise<RelocateOutcome> => {
        for (const [sessionId, entry] of related) {
          if (await jobsBusy(sessionId, entry)) return { kind: "busy" };
        }

        for (const [, entry] of related) await runners.stopRunner(entry);

        const watch = pool.watching(id, pooled, destination.changes);
        const outcome = await pool
          .currentPlugins(destination)
          .then((plugins) =>
            activate({
              target: { kind: "session", session: pooled.session },
              plugins: pluginsFor({ id, pooled, plugins }),
              env: destination.env,
            }),
          )
          .catch((cause: unknown) => {
            watch?.stop();
            throw cause;
          });

        if (outcome.kind === "failed") {
          watch?.stop();

          return { kind: "failed", error: outcome.error };
        }
        const next = watch === undefined ? outcome.activation : watch.attach(outcome.activation);

        try {
          signal.throwIfAborted();
          pool.alive();
          const written = await pool.writeWorkspace(pooled.session, input.workspace, expect);

          if (!written) {
            await next.close();

            return { kind: "busy" };
          }
        } catch (cause) {
          await next.close();
          throw cause;
        }

        // Descendants resolve through the root again on their next use.
        for (const [entryId, entry] of related) {
          if (entryId === id) continue;
          await entry.activation
            ?.close()
            .catch((cause: unknown) => runners.emitRunnerDiagnostic(entry.session, cause));
          entry.activation = undefined;
          entry.activationState = undefined;
        }

        const previous = pooled.activation;
        pooled.activationState = { ...destination, resolvedFor: input.workspace };
        pooled.activation = next;
        watch?.start();
        next.subscribe((notice) => pool.dispatchNotice(pooled, notice));
        await previous
          ?.close()
          .catch((cause: unknown) => runners.emitRunnerDiagnostic(pooled.session, cause));
        await pool.dispatchNotice(pooled, {
          kind: "activation_changed",
          activation: { kind: "active" },
        });
        await pool.dispatchNotice(pooled, {
          kind: "plugins_changed",
          plugins: next.plugins.list(),
        });
        await pool.dispatchNotice(pooled, { kind: "status_changed", items: next.statuses() });

        return { kind: "relocated" };
      };

      // Compaction and foreign runners use these same leases. Hold them through
      // plugin activation so work cannot start between the idle check and the swap.
      const reserve = async (index: number, signal: AbortSignal): Promise<RelocateOutcome> => {
        const target = heads[index];

        if (target === undefined) return replace(signal);
        const acquired = await target.session.leases.acquire(headRef(target.head), 15_000);

        if (!acquired.ok) return { kind: "busy" };

        try {
          const run = await pool.readRun(target.session, target.head);

          if (
            !restoring &&
            ((run !== undefined && !isTerminalPhase(run.run.phase)) ||
              (await queuedWork(target.session, target.head, run?.run)))
          )
            return { kind: "busy" };

          return await withLeaseRenewal(
            { session: target.session, lease: acquired.lease, ttlMs: 15_000, signal },
            (signal) => reserve(index + 1, signal),
          );
        } finally {
          await target.session.leases.release(acquired.lease);
        }
      };

      return await reserve(0, new AbortController().signal);
    } finally {
      pooled.relocating = false;
      for (const [entryId, entry] of related) {
        await runners
          .reconcileRunner(entryId, entry)
          .catch((cause: unknown) => runners.emitRunnerDiagnostic(entry.session, cause));
      }
    }
  };

  return { sessionCwd, sessionWorkspace, relocate };
}
