/**
 * Moving one idle session to another trusted directory: every head and job of
 * the session and its children must be quiet, the head leases are held through
 * plugin activation, and only then is the saved directory replaced.
 */
import { DEFAULT_LANDING, isTerminalPhase } from "@nyte-ai/protocol";
import type { LoadedPlugin } from "../../plugins/types.ts";
import { landsNow } from "../admission.ts";
import { withLeaseRenewal } from "../lease.ts";
import type { Run } from "../model.ts";
import { headRef } from "../names.ts";
import { pending } from "../queue.ts";
import type { Session } from "../store.ts";
import { activate } from "./activation.ts";
import { JOB_PREFIX } from "./jobs.ts";
import type { Runners } from "./runner.ts";
import { CWD_FACT, type Pooled, type SessionPool } from "./session-pool.ts";
import type { Subagents } from "./subagent-host.ts";
import {
  sessionId,
  type HeadName,
  type Nyte,
  type NyteOptions,
  type SessionId,
  type TrustedWorkspace,
} from "./types.ts";

type RelocateOutcome = Awaited<ReturnType<Nyte["relocate"]>>;

export function createRelocation(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly runners: Runners;
  readonly subagents: Pick<Subagents, "jobsFor" | "pluginsFor">;
}) {
  const { options, pool, runners } = input;
  const { jobsFor, pluginsFor } = input.subagents;
  const drain = (options.landing ?? DEFAULT_LANDING).drain;
  /** Queued work the runner would land now. A completion waiting for user input is not. */
  const queuedWork = async (
    session: Session,
    head: HeadName,
    run: Run | undefined,
  ): Promise<boolean> => landsNow(run, await pending(session, head), drain);

  const sessionCwd = async (input: {
    readonly sessionId: SessionId;
  }): Promise<string | undefined> => {
    const pooled = await pool.open(input.sessionId);
    const cwd = await pool.storedCwd(pooled.session);
    if (cwd !== undefined) return cwd;
    const state = await pool.resolveSessionActivation(input.sessionId, pooled);
    return state.kind === "active" ? state.env.cwd : undefined;
  };

  const relocate = async (input: {
    readonly sessionId: SessionId;
    readonly workspace: TrustedWorkspace;
    readonly plugins: readonly LoadedPlugin[];
  }): Promise<RelocateOutcome> => {
    const id = input.sessionId;
    const pooled = await pool.open(id);
    if (pooled.relocating) return { kind: "busy" };
    // Stop new local drives before the first await. Existing work is rejected, never aborted.
    pooled.relocating = true;
    try {
      await pooled.reconciliation;
      await pooled.opening;
      await pooled.resolving;
      await pool.resolveSessionActivation(id, pooled);
      const restoring =
        (await pool.storedCwd(pooled.session)) === input.workspace.cwd &&
        pooled.activationState?.kind !== "active";
      const related: [SessionId, Pooled][] = [[id, pooled]];
      for (const stored of await options.store.list()) {
        if (stored.id === id) continue;
        const childId = sessionId(stored.id);
        const child = await pool.open(childId);
        if (child.parent?.sessionId === id) related.push([childId, child]);
      }
      /** Live job work, or a job lease another owner still holds, blocks the move. */
      const jobsBusy = async (sessionId: SessionId, entry: Pooled): Promise<boolean> => {
        for (const job of await jobsFor(sessionId, entry).list()) {
          if (!restoring && job.state === "running") return true;
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
        await runners.stopRunner(pooled);
        const next = await activate({
          target: { kind: "session", session: pooled.session },
          plugins: pluginsFor({ id, pooled, plugins: input.plugins }),
          env: { cwd: input.workspace.cwd },
        });
        try {
          const failed = next.plugins.list().filter((plugin) => plugin.status === "failed");
          if (failed.length > 0)
            throw new Error(
              `Destination plugin setup failed: ${failed.map((plugin) => plugin.id).join(", ")}`,
            );
          signal.throwIfAborted();
          pool.alive();
          await pool.writeFact(pooled.session, CWD_FACT, input.workspace.cwd);
        } catch (cause) {
          await next.close();
          throw cause;
        }
        const previous = pooled.activation;
        pooled.activationState = {
          kind: "active",
          plugins: input.plugins,
          env: { cwd: input.workspace.cwd },
        };
        pooled.scopedPlugins = true;
        pooled.activation = next;
        pooled.activationCwd = input.workspace.cwd;
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
      await runners.reconcileRunner(id, pooled);
      for (const [childId, child] of pool.entries()) {
        if (child.parent?.sessionId === id) await runners.reconcileRunner(childId, child);
      }
    }
  };

  return { sessionCwd, relocate };
}
