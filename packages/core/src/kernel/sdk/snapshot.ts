import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { isThinkingLevel } from "../loop/types.ts";
import { branchConfig } from "@nyte-ai/client";
import type { Commit, Lease, Oid, Run } from "../model.ts";
import type { PendingChange } from "../queue.ts";
import type { ListedHead } from "../stacks.ts";
import { sessionDirectoryEntry } from "@nyte-ai/client";
import {
  sessionId,
  type HeadInfo,
  type PendingItem,
  type RunConfig,
  type RunInfo,
  type SessionActivationState,
  type SessionInfo,
  type SessionParent,
  type WorkspaceRef,
} from "./types.ts";

export const NAME_FACT = "name";

export const PINNED_FACT = "pinned";

export const ARCHIVED_FACT = "archived";

export const PARENT_FACT = "parent";

const SessionParentFact = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  runId: Type.String(),
  callId: Type.String(),
  depth: Type.Number(),
});

const StringFact = Type.String();

/** Parse the durable parent link without letting malformed fact data escape. */
export function parentFromFact(value: JsonValue | undefined): SessionParent | undefined {
  if (!Value.Check(SessionParentFact, value)) return undefined;

  return {
    sessionId: sessionId(value.sessionId),
    runId: value.runId,
    callId: value.callId,
    depth: value.depth,
  };
}

/** Project a listed head after the caller has read its parent's current tip. */
export function headInfo(listed: ListedHead, parentTip: Oid | null, run?: RunInfo): HeadInfo {
  const stack = listed.stack;

  const base = {
    head: listed.head,
    tip: listed.tip,
  };

  const withStack =
    stack === undefined
      ? base
      : {
          ...base,
          stack: {
            parent: stack.parent,
            base: stack.base,
            stale: stack.base !== parentTip,
          },
        };

  return run === undefined ? withStack : { ...withStack, run };
}

/** Project the durable run and its live lease, when present. */
export function runInfo(run: Run, lease?: Lease): RunInfo {
  const base = {
    runId: run.id,
    head: run.head,
    origin: run.origin,
    root: run.root,
    phase: run.phase,
    startedAt: run.startedAt,
    attempts: run.attempts,
    config: clientRunConfig(run.config),
  };

  const withAbort =
    run.abortRequested === undefined ? base : { ...base, abortRequested: run.abortRequested };

  return withLease(withAbort, lease);
}

/** The run as `lease` finds it now: a lease the run no longer holds is dropped, not kept. */
export function withLease(run: RunInfo, lease: Lease | undefined): RunInfo {
  const { lease: _held, ...rest } = run;

  return lease === undefined
    ? rest
    : { ...rest, lease: { owner: lease.owner, expiresAt: lease.expiresAt } };
}

/** Only submitted user messages are client-visible queue items; completions and the rest are not. */
export function pendingItem(item: PendingChange): PendingItem | undefined {
  const body = item.change.body;

  switch (body.kind) {
    case "message": {
      const pending = {
        change: item.oid,
        delivery: item.delivery,
        at: item.change.at,
        content: body.message.content,
      };

      const sourced = body.source === undefined ? pending : { ...pending, source: body.source };
      const keyed = item.change.key === undefined ? sourced : { ...sourced, key: item.change.key };

      return item.change.author === undefined ? keyed : { ...keyed, author: item.change.author };
    }

    case "completion":
    case "config":
      return undefined;
    default: {
      const _exhaustive: never = body;

      return _exhaustive;
    }
  }
}

export function pendingItems(pending: readonly PendingChange[]): readonly PendingItem[] {
  const items: PendingItem[] = [];

  for (const change of pending) {
    const item = pendingItem(change);

    if (item !== undefined) items.push(item);
  }

  return items;
}

function clientRunConfig(stored: Run["config"]): RunConfig {
  let config: RunConfig = {};

  if (stored.model !== undefined) config = { ...config, model: stored.model };

  if (stored.thinkingLevel !== undefined && isThinkingLevel(stored.thinkingLevel)) {
    config = { ...config, thinkingLevel: stored.thinkingLevel };
  }

  if (stored.agent !== undefined) config = { ...config, agent: stored.agent };

  return config;
}

/** Shared head read model. An observing host's defaults are not evidence of what ran. */
export function headConfig(commits: readonly Commit[], run: RunInfo | undefined): RunConfig {
  const declared = clientRunConfig(branchConfig(commits));

  const latestIndex = commits.findLastIndex(
    (commit) => commit.body.kind === "message" && commit.body.message.role === "assistant",
  );

  const latest = commits[latestIndex];
  const message = latest?.body.kind === "message" ? latest.body.message : undefined;

  const observed: RunConfig =
    message?.role === "assistant"
      ? { model: { provider: message.provider, id: message.model } }
      : {};

  const onBranch = run !== undefined && commits.some((commit) => commit.run === run.runId);

  if (
    onBranch &&
    run.phase.kind !== "done" &&
    run.phase.kind !== "aborted" &&
    run.phase.kind !== "failed"
  ) {
    return latest?.run === run.runId ? { ...observed, ...run.config } : run.config;
  }

  const recorded = onBranch ? run.config : {};
  // An agent changed since the last response may supply a different default model.
  const responseAgent = branchConfig(commits.slice(0, latestIndex + 1)).agent;

  const inherited =
    declared.agent === recorded.agent || declared.agent === responseAgent
      ? { ...observed, ...recorded }
      : {};

  return { ...inherited, ...declared };
}

/** Build the session row and its selected main-branch inputs, including unlanded choices. */
export function sessionInfo(input: {
  readonly id: string;
  readonly activation: SessionActivationState;
  readonly workspace: WorkspaceRef;
  readonly createdAt: number;
  readonly heads: readonly HeadInfo[];
  readonly facts: ReadonlyMap<string, JsonValue>;
  readonly mainCommits: readonly Commit[];
  readonly pendingChanges: readonly PendingChange[];
}): SessionInfo {
  const row = sessionDirectoryEntry({
    id: input.id,
    createdAt: input.createdAt,
    heads: input.heads.map((head) => head.head),
    commits: input.mainCommits,
  });

  // A queued choice can land between the queue read and the branch read.
  const landed = new Set(input.mainCommits.map((commit) => commit.change));

  const selected = branchConfig([
    ...input.mainCommits,
    ...input.pendingChanges.filter((item) => !landed.has(item.oid)).map((item) => item.change),
  ]);

  const history = {
    sessionId: sessionId(input.id),
    activation: input.activation,
    workspace: input.workspace,
    createdAt: input.createdAt,
    lastActivityAt: row.lastActivity,
    heads: input.heads,
    config: clientRunConfig(selected),
  };

  return withFacts(
    row.preview === undefined ? history : { ...history, preview: row.preview },
    input.facts,
  );
}

/** The facts a session row reads; any other fact leaves the row as it is. */
export const ROW_FACTS = [NAME_FACT, PINNED_FACT, ARCHIVED_FACT, PARENT_FACT] as const;

/** What a session's history and its host decide about its row; facts decide the rest. */
export type HistoryRow = Omit<SessionInfo, "name" | "pinned" | "archived" | "parent">;

/** The row's fact-owned fields, the only reading of those facts. */
export function factFields(
  facts: ReadonlyMap<string, JsonValue>,
): Pick<SessionInfo, "name" | "pinned" | "archived" | "parent"> {
  const nameFact = facts.get(NAME_FACT);
  const parent = parentFromFact(facts.get(PARENT_FACT));

  const flags = {
    pinned: facts.get(PINNED_FACT) === true,
    archived: facts.get(ARCHIVED_FACT) === true,
  };

  const named = Value.Check(StringFact, nameFact) ? { ...flags, name: nameFact } : flags;

  return parent === undefined ? named : { ...named, parent };
}

/**
 * The row for `history` under `facts`. Every field is named, never spread, so
 * a removed name or parent leaves nothing behind even when `history` is a
 * whole earlier row.
 */
export function withFacts(history: HistoryRow, facts: ReadonlyMap<string, JsonValue>): SessionInfo {
  const fields = factFields(facts);

  const base = {
    sessionId: history.sessionId,
    activation: history.activation,
    workspace: history.workspace,
    createdAt: history.createdAt,
    lastActivityAt: history.lastActivityAt,
    pinned: fields.pinned,
    archived: fields.archived,
    heads: history.heads,
    config: history.config,
  };

  const withName = fields.name === undefined ? base : { ...base, name: fields.name };

  const withPreview =
    history.preview === undefined ? withName : { ...withName, preview: history.preview };

  return fields.parent === undefined ? withPreview : { ...withPreview, parent: fields.parent };
}
