/**
 * Prompt-cache warming for pooled sessions: one `CacheWarmer` per session
 * head, started from the exact request the runner dispatched. A warm request
 * never touches the branch; its usage lands on a usage chain beside the head
 * so billing is durable without moving the transcript tip.
 *
 * A warmed request stays current while the head's branch still extends the
 * branch it was sent from. Head ref events drive that check: new commits are
 * walked back to the last known tip, a checkpoint, a summary, or a model
 * change ends the run, and a tip that does not descend from the known one
 * ends it too.
 */
import type { Api, Model, Usage } from "@nyte-ai/ai";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Commit, Event, Obj, Oid, RefName } from "../model.ts";
import { headRef, parseHeadRef } from "../names.ts";
import type { Session } from "../store.ts";
import {
  CacheWarmer,
  type CacheWarmingMode,
  type CacheWarmingStatus,
  type CacheWarmUsage,
} from "../cache-warmer.ts";
import type { Activation } from "./activation.ts";
import type { StreamFn } from "../loop/types.ts";
import type { DispatchedRequest, RequestInvocation } from "./requests.ts";
import { headFromRunRef } from "./runner.ts";
import { attributed, type Pooled, type SessionPool } from "./session-pool.ts";
import type { HeadName, NyteOptions, SessionId } from "./types.ts";

const USAGE_PREFIX = "refs/usage/";

/** Billing for model calls on a head that produced no message, kept off the branch. */
export function usageRef(head: string): RefName {
  return USAGE_PREFIX + head;
}

/** Commits read per page while walking new history back to the known tip. */
const WALK_PAGE = 64;
/** Commits inspected for the latest reply when a head is first warmed. */
const BASELINE_LIMIT = 256;

interface HeadWarming {
  readonly warmer: CacheWarmer;
  /** Tip reads and history walks run one after another, each seeing the previous outcome. */
  queue: Promise<void>;
  /** The branch tip every later head event is walked back to. */
  known: Oid | null;
  /** Head events at or below this seq were covered by the last tip read. */
  seen: number;
  promptTokens: number;
  /** Set once the warmed request's branch, model, or run no longer holds. */
  current?: { ok: boolean };
  runId?: string;
  model?: Model<Api>;
}

function promptSize(usage: Usage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

function sameModel(model: Model<Api>, ref: { provider?: string; id: string }): boolean {
  return ref.id === model.id && (ref.provider === undefined || ref.provider === model.provider);
}

/** Whether a commit landing on the branch keeps the warmed request's prompt a prefix of the next one. */
function extendsPrompt(object: Obj, model: Model<Api> | undefined): boolean {
  if (object.kind !== "commit") return false;

  switch (object.body.kind) {
    case "message":
    case "completion":
    case "usage":
      return true;
    case "config":
      return (
        object.body.model === undefined ||
        model === undefined ||
        sameModel(model, object.body.model)
      );
    case "checkpoint":
    case "summary":
      return false;
    default: {
      const _exhaustive: never = object.body;

      return _exhaustive;
    }
  }
}

export function createCacheWarming(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly reportBackground: (cause: unknown) => void;
}) {
  const { options, pool } = input;
  const mode = options.cacheWarming ?? (() => "streaming");
  const sessions = new Map<Pooled, Map<HeadName, HeadWarming>>();

  const appendUsage = async (session: Session, head: HeadName, usage: CacheWarmUsage) => {
    const name = usageRef(head);

    for (;;) {
      const from = await session.refs.read(name);
      const baseCommit: Commit = {
        kind: "commit",
        parent: from,
        at: Date.now(),
        body: { kind: "usage", ...usage },
      };

      const commit: Commit =
        options.actor === undefined ? baseCommit : { ...baseCommit, author: options.actor };
      const [to] = await session.objects.put([commit]);

      if (to === undefined) throw new Error(`Writing usage for ${name} returned no oid`);
      const outcome = await session.refs.update(
        [{ name, from, to }],
        attributed({ reason: "cache_warm" }, options.actor),
      );

      if (outcome.ok) return;

      switch (outcome.reason) {
        case "conflict":
          continue;
        case "fenced":
          throw new Error(`Usage write was unexpectedly fenced: ${name}`);
        default: {
          const _exhaustive: never = outcome;

          return _exhaustive;
        }
      }
    }
  };

  /**
   * Walk from `from` back toward `until`, newest first. Reports whether `until`
   * was reached, the latest reply's prompt size among the commits passed, and
   * whether every commit passed keeps the warmed prompt a prefix of the next.
   */
  const walk = async (
    session: Session,
    from: Oid | null,
    until: Oid | null,
    model: Model<Api> | undefined,
    limit: number,
  ): Promise<{ reached: boolean; promptTokens?: number; extends: boolean }> => {
    let cursor = from;
    let promptTokens: number | undefined;
    let extending = true;
    let walked = 0;

    while (cursor !== null && cursor !== until && walked < limit) {
      const page = await session.objects.chain(cursor, { limit: WALK_PAGE });

      if (page.length === 0) return { reached: false, promptTokens, extends: extending };

      for (const { oid, object } of page) {
        if (oid === until) return { reached: true, promptTokens, extends: extending };
        walked += 1;

        if (!extendsPrompt(object, model)) extending = false;

        if (
          promptTokens === undefined &&
          object.kind === "commit" &&
          object.body.kind === "message" &&
          object.body.message.role === "assistant"
        ) {
          promptTokens = promptSize(object.body.message.usage);
        }
        cursor = object.kind === "commit" ? object.parent : null;
      }
    }

    return { reached: cursor === until, promptTokens, extends: extending };
  };

  const enqueue = (entry: HeadWarming, task: () => Promise<void>): Promise<void> => {
    const run = entry.queue.then(task);
    entry.queue = run.catch(input.reportBackground);

    return run;
  };

  const invalidate = (entry: HeadWarming): void => {
    if (entry.current !== undefined) entry.current.ok = false;
  };

  const entriesFor = (pooled: Pooled): Map<HeadName, HeadWarming> => {
    const found = sessions.get(pooled);

    if (found !== undefined) return found;
    const heads = new Map<HeadName, HeadWarming>();
    sessions.set(pooled, heads);

    return heads;
  };

  const entryFor = (
    id: SessionId,
    pooled: Pooled,
    head: HeadName,
    activation: Activation,
    streamFn: StreamFn,
  ): HeadWarming => {
    const heads = entriesFor(pooled);
    const found = heads.get(head);

    if (found !== undefined) return found;
    const entry: HeadWarming = {
      warmer: new CacheWarmer({
        streamSimple: (model, context, streamOptions) =>
          streamFn(model, context, { ...streamOptions, telemetryContext: options.telemetry }),
        promptTokens: () => entry.promptTokens,
        appendUsage: (usage) => appendUsage(pooled.session, head, usage),
        getMode: mode,
        decide: async (event) => {
          const model = entry.model;

          if (model === undefined || !activation.hooks.has("cache_warming_decision")) {
            return event.action;
          }
          const { type: _type, ...decision } = event;
          const result = await activation.hooks.run("cache_warming_decision", {
            ...decision,
            head,
            runId: entry.runId ?? "",
            sessionId: id,
            model: { provider: model.provider, modelId: model.id },
          });

          return result?.action ?? event.action;
        },
      }),
      queue: Promise.resolve(),
      known: null,
      seen: 0,
      promptTokens: 0,
    };
    heads.set(head, entry);

    return entry;
  };

  const onHeadMoved = (pooled: Pooled, entry: HeadWarming, event: Event): Promise<void> =>
    enqueue(entry, async () => {
      if (event.kind !== "ref" || event.seq <= entry.seen) return;
      const before = entry.known;
      const result = await walk(pooled.session, event.to, before, entry.model, Infinity);
      entry.known = event.to;
      entry.seen = event.seq;

      if (result.promptTokens !== undefined) entry.promptTokens = result.promptTokens;

      if (!result.reached || !result.extends) invalidate(entry);
    });

  return {
    request: async (
      id: SessionId,
      pooled: Pooled,
      activation: Activation,
      streamFn: StreamFn,
      request: DispatchedRequest,
      invocation: RequestInvocation,
    ): Promise<void> => {
      if (mode() === "off") return;
      const head = invocation.head;
      const entry = entryFor(id, pooled, head, activation, streamFn);
      invalidate(entry);
      const token = { ok: true };
      entry.current = token;
      entry.runId = invocation.runId;
      entry.model = request.model;

      await enqueue(entry, async () => {
        const { session } = pooled;
        const tip = await session.refs.read(headRef(head));
        const seen = await session.events.last();
        const result = await walk(session, tip, entry.known, request.model, BASELINE_LIMIT);
        entry.known = tip;
        entry.seen = seen;

        if (result.promptTokens !== undefined) entry.promptTokens = result.promptTokens;
      });

      if (entry.current !== token || pooled.retired || pooled.relocating) return;
      entry.warmer.start(request, () => token.ok);
    },

    /** A ref event on the session: head moves re-check the warmed prefix; a run's end settles it. */
    onRef: async (pooled: Pooled, event: Extract<Event, { readonly kind: "ref" }>) => {
      const heads = sessions.get(pooled);

      if (heads === undefined) return;
      const movedHead = parseHeadRef(event.name);

      if (movedHead !== undefined) {
        const entry = heads.get(movedHead);

        if (entry !== undefined) await onHeadMoved(pooled, entry, event);

        return;
      }
      const runHead = headFromRunRef(event.name);

      if (runHead === undefined) return;
      const entry = heads.get(runHead);

      if (entry === undefined || entry.runId === undefined) return;
      const stored = await pool.readRun(pooled.session, runHead);

      if (stored?.run.id === entry.runId && isTerminalPhase(stored.run.phase)) {
        entry.warmer.onAgentSettled();
      }
    },

    cancel: (pooled: Pooled): void => {
      const heads = sessions.get(pooled);

      if (heads === undefined) return;
      sessions.delete(pooled);

      for (const entry of heads.values()) {
        invalidate(entry);
        entry.warmer.cancel();
      }
    },

    status: (pooled: Pooled | undefined, head: HeadName): CacheWarmingStatus => {
      const entry = pooled === undefined ? undefined : sessions.get(pooled)?.get(head);

      if (entry !== undefined) return entry.warmer.status;

      return {
        state: "inactive",
        reason: mode() === "off" ? "cache warming disabled" : "waiting for first request",
      };
    },

    modeChanged: (): void => {
      for (const heads of sessions.values()) {
        for (const entry of heads.values()) entry.warmer.onModeChanged();
      }
    },
  };
}

export type CacheWarming = ReturnType<typeof createCacheWarming>;
export type { CacheWarmingMode };
