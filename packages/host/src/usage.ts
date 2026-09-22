import { Buffer } from "node:buffer";
import { constants, existsSync } from "node:fs";
import { lstat, open, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  calculateCost,
  fetchAnthropicAccountLimits,
  fetchOpenAICodexAccountLimits,
  hasApi,
  type AccountLimits,
  type Models,
} from "@nyte-ai/ai";
import {
  emptyUsageSummary,
  mergeUsageSummaries,
  type ModelUsage,
  type UsageSummary,
} from "@nyte-ai/client";
import type { Usage } from "@nyte-ai/schema";

export interface ClaudeCodeUsageOptions {
  readonly models: Pick<Models, "getModels">;
  readonly configDir?: string;
  readonly signal?: AbortSignal;
  /** Parsed files from earlier reads; unchanged files are reused, gone files dropped. */
  readonly cache?: UsageScanCache<ClaudeCodeFileScan>;
}

/**
 * Transcripts are append-only, so a file that still has the size and mtime it
 * had when it was last parsed cannot yield different usage. Readers key their
 * per-file results on that pair and only parse what changed; a warm read of
 * a gigabyte of history is then dominated by stat calls, not JSON.
 *
 * Deduplication that crosses files is left to the read, over the small set of
 * cached records, so a cache hit and a cold parse reconcile identically.
 */
export type UsageScanCache<T> = Map<string, FileScan<T>>;

export interface FileScan<T> {
  readonly size: number;
  readonly mtimeMs: number;
  readonly scan: T;
}

/** One Claude Code transcript, deduplicated within itself. */
export interface ClaudeCodeFileScan {
  /** Best snapshot per message or request identity. */
  readonly keyed: readonly (readonly [string, Snapshot])[];
  /** Snapshots with no identity at all, which never merge with anything. */
  readonly anonymous: readonly Snapshot[];
  readonly malformedRecords: number;
}

export type LocalHistoryUsage =
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly summary: UsageSummary;
      readonly unpricedRecords: number;
      readonly malformedRecords: number;
      readonly unreadableFiles: number;
    };

export type ClaudeCodeUsage = LocalHistoryUsage;

const tokens = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

const envelope = Type.Object({ type: Type.String() });

const assistantRecord = Type.Object({
  type: Type.Literal("assistant"),
  requestId: Type.Optional(Type.String()),
  costUSD: Type.Optional(Type.Unknown()),
  message: Type.Object({
    id: Type.Optional(Type.String()),
    model: Type.String({ minLength: 1, pattern: "\\S" }),
    usage: Type.Object({
      input_tokens: tokens,
      output_tokens: tokens,
      cache_read_input_tokens: Type.Optional(tokens),
      cache_creation_input_tokens: Type.Optional(tokens),
      cache_creation: Type.Optional(
        Type.Object({
          ephemeral_5m_input_tokens: Type.Optional(tokens),
          ephemeral_1h_input_tokens: Type.Optional(tokens),
        }),
      ),
    }),
  }),
});

const reportedCost = Type.Number({ minimum: 0, maximum: Number.MAX_VALUE });

export interface Snapshot {
  readonly model: string;
  readonly usage: Usage;
  readonly costUSD: number | undefined;
}

/**
 * Content blocks and copied histories repeat snapshots. Keep one whole largest
 * snapshot regardless of timestamps, not field-wise maxima that invent a response.
 */
function betterSnapshot(previous: Snapshot | undefined, next: Snapshot): boolean {
  if (previous === undefined) return true;
  const usage = next.usage;

  return (
    usage.totalTokens > previous.usage.totalTokens ||
    (usage.totalTokens === previous.usage.totalTokens &&
      (usage.output > previous.usage.output ||
        (usage.output === previous.usage.output &&
          previous.costUSD === undefined &&
          next.costUSD !== undefined)))
  );
}

/** Parse one transcript in full. Throws when the file cannot be read. */
async function scanClaudeCodeFile(
  path: string,
  signal: AbortSignal | undefined,
): Promise<ClaudeCodeFileScan> {
  const keyed = new Map<string, Snapshot>();
  const anonymous: Snapshot[] = [];
  let malformedRecords = 0;

  for await (const line of historyLines(path, signal)) {
    signal?.throwIfAborted();

    if (!line.text.trim()) continue;
    let value: unknown;

    try {
      value = JSON.parse(line.text);
    } catch {
      // A writer may still be appending the last JSON object.
      if (line.terminated) malformedRecords++;
      continue;
    }

    if (!Value.Check(envelope, value)) {
      malformedRecords++;
      continue;
    }

    if (value.type !== "assistant") continue;

    if (!Value.Check(assistantRecord, value)) {
      malformedRecords++;
      continue;
    }

    const raw = value.message.usage;
    const cacheWrite = raw.cache_creation_input_tokens ?? 0;
    const cacheWrite1h = raw.cache_creation?.ephemeral_1h_input_tokens;

    if ((cacheWrite1h ?? 0) + (raw.cache_creation?.ephemeral_5m_input_tokens ?? 0) > cacheWrite) {
      malformedRecords++;
      continue;
    }

    const usage: Usage = {
      ...emptyUsageSummary().total,
      input: raw.input_tokens,
      output: raw.output_tokens,
      cacheRead: raw.cache_read_input_tokens ?? 0,
      cacheWrite,
      totalTokens:
        raw.input_tokens + raw.output_tokens + (raw.cache_read_input_tokens ?? 0) + cacheWrite,
    };

    if (cacheWrite1h !== undefined) usage.cacheWrite1h = cacheWrite1h;

    const snapshot: Snapshot = {
      model: value.message.model,
      usage,
      costUSD: Value.Check(reportedCost, value.costUSD) ? value.costUSD : undefined,
    };

    const messageId = value.message.id?.trim() || null;
    const requestId = value.requestId?.trim() || null;

    if (messageId === null && requestId === null) {
      anonymous.push(snapshot);
      continue;
    }

    const identity = JSON.stringify([messageId, requestId]);

    if (betterSnapshot(keyed.get(identity), snapshot)) keyed.set(identity, snapshot);
  }

  return { keyed: [...keyed], anonymous, malformedRecords };
}

/**
 * Parse a file, or reuse the parse from a cache entry that still matches the
 * file on disk. `seen` collects the paths of this read so the cache can drop
 * files that no longer exist once the walk completes.
 */
async function scanCached<T>(
  path: string,
  cache: UsageScanCache<T> | undefined,
  seen: Set<string>,
  parse: () => Promise<T>,
): Promise<T> {
  seen.add(path);

  if (cache === undefined) return parse();
  const info = await lstat(path);

  if (!info.isFile()) throw new Error("History is not a regular file.");
  const hit = cache.get(path);

  if (hit !== undefined && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.scan;
  const scan = await parse();
  cache.set(path, { size: info.size, mtimeMs: info.mtimeMs, scan });

  return scan;
}

/** After a complete walk, whatever the walk did not visit is gone. */
function pruneCache<T>(cache: UsageScanCache<T> | undefined, seen: Set<string>): void {
  if (cache === undefined) return;

  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
}

/** Local history across all projects, separate from Nyte usage. Aborts reject with signal.reason. */
export async function readClaudeCodeUsage(
  options: ClaudeCodeUsageOptions,
): Promise<ClaudeCodeUsage> {
  options.signal?.throwIfAborted();

  const projects = join(
    resolve(
      options.configDir ?? (process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude")),
    ),
    "projects",
  );

  if (!existsSync(projects)) return { kind: "missing" };

  try {
    // Configured roots may be symlinks, as may system ancestors such as macOS /tmp.
    const root = await stat(projects);
    options.signal?.throwIfAborted();

    if (!root.isDirectory())
      return { kind: "failed", message: "Claude Code history path is not a directory." };
  } catch {
    options.signal?.throwIfAborted();

    return { kind: "failed", message: "Could not open Claude Code local history." };
  }

  const keyed = new Map<string, Snapshot>();
  const anonymous: Snapshot[] = [];
  const seen = new Set<string>();
  let malformedRecords = 0;
  let unreadableFiles = 0;

  try {
    const directories = [projects];

    for (const directory of directories) {
      options.signal?.throwIfAborted();

      try {
        // Follow the configured root, but skip child links to avoid loops and duplicate history.
        if (directory !== projects && (await lstat(directory)).isSymbolicLink()) continue;
        const entries = await opendir(directory);

        for await (const entry of entries) {
          options.signal?.throwIfAborted();
          const path = join(directory, entry.name);

          if (entry.isDirectory()) {
            directories.push(path);
            continue;
          }

          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

          try {
            const scan = await scanCached(path, options.cache, seen, () =>
              scanClaudeCodeFile(path, options.signal),
            );

            malformedRecords += scan.malformedRecords;
            anonymous.push(...scan.anonymous);

            for (const [identity, snapshot] of scan.keyed) {
              if (betterSnapshot(keyed.get(identity), snapshot)) keyed.set(identity, snapshot);
            }
          } catch {
            options.signal?.throwIfAborted();
            unreadableFiles++;
          }
        }
      } catch (error) {
        options.signal?.throwIfAborted();

        if (directory === projects) throw error;
        unreadableFiles++;
      }
    }

    options.signal?.throwIfAborted();
    pruneCache(options.cache, seen);

    const catalog = options.models
      .getModels("anthropic")
      .filter((model) => model.provider === "anthropic");

    const rows: ModelUsage[] = [];
    let unpricedRecords = 0;

    for (const snapshot of [...keyed.values(), ...anonymous]) {
      options.signal?.throwIfAborted();
      // Cached usage is priced on every read, since the catalog can change
      // between reads while the transcript does not. Copy before writing.
      const usage: Usage = { ...snapshot.usage, cost: { ...snapshot.usage.cost } };

      if (snapshot.costUSD !== undefined) {
        // History reports a total, not a cost breakdown. Do not invent allocations.
        usage.cost.total = snapshot.costUSD;
      } else {
        const matches = catalog.filter((model) => model.id === snapshot.model);
        const model = matches.length === 1 ? matches[0] : undefined;

        if (model) calculateCost(model, usage);
        else unpricedRecords++;
      }

      rows.push({ provider: "anthropic", model: snapshot.model, turns: 1, usage });
    }

    options.signal?.throwIfAborted();

    return {
      kind: "ready",
      summary: mergeUsageSummaries(emptyUsageSummary(), { ...emptyUsageSummary(), models: rows }),
      unpricedRecords,
      malformedRecords,
      unreadableFiles,
    };
  } catch {
    options.signal?.throwIfAborted();

    return { kind: "failed", message: "Could not read Claude Code local history." };
  }
}

/**
 * Codex local history, read from the rollout files the CLI writes per session.
 *
 * Two on-disk formats are in play. Current rollouts carry a `token_usage_record`
 * per model response, whose `usage` is already the delta and whose `response_id`
 * is unique across every file, so counting them is a set union and needs no
 * heuristics. Archived rollouts predate that record and only carry the
 * `token_count` event, whose `last_token_usage` is re-emitted unchanged on some
 * stream boundaries and, in a forked or subagent rollout, is preceded by the
 * parent's whole history re-stamped to the fork instant. Both have to be
 * dropped there or the archive reads about a tenth high.
 *
 * A file is read one way or the other, never both: the modern record wins
 * whenever the file has any, because the legacy event is still written
 * alongside it and would double every response that has both.
 */
export type CodexUsage = LocalHistoryUsage;

export interface CodexUsageOptions {
  readonly models: Pick<Models, "getModels">;
  readonly homeDir?: string;
  readonly signal?: AbortSignal;
  /** Parsed rollouts from earlier reads; unchanged files are reused, gone files dropped. */
  readonly cache?: UsageScanCache<CodexFileScan>;
}

/** What one rollout file contributed, before the two formats are reconciled. */
export interface CodexFileScan {
  readonly modern: readonly (readonly [string, CodexRow])[];
  readonly legacy: readonly CodexRow[];
  readonly malformedRecords: number;
}

export interface CodexRow {
  readonly model: string;
  readonly usage: Usage;
}

const codexTokens = Type.Object({
  input_tokens: Type.Optional(tokens),
  cached_input_tokens: Type.Optional(tokens),
  cache_write_input_tokens: Type.Optional(tokens),
  output_tokens: Type.Optional(tokens),
  reasoning_output_tokens: Type.Optional(tokens),
});

const usageRecord = Type.Object({
  type: Type.Literal("token_usage_record"),
  payload: Type.Object({
    response_id: Type.Optional(Type.String()),
    usage: codexTokens,
  }),
});

const turnContext = Type.Object({
  type: Type.Literal("turn_context"),
  payload: Type.Object({ model: Type.Optional(Type.String({ minLength: 1 })) }),
});

const sessionMeta = Type.Object({
  type: Type.Literal("session_meta"),
  timestamp: Type.Optional(Type.String()),
  payload: Type.Object({
    forked_from_id: Type.Optional(Type.String()),
    parent_thread_id: Type.Optional(Type.String()),
  }),
});

const tokenCount = Type.Object({
  type: Type.Literal("event_msg"),
  timestamp: Type.Optional(Type.String()),
  payload: Type.Object({
    type: Type.Literal("token_count"),
    info: Type.Object({ last_token_usage: Type.Optional(codexTokens) }),
  }),
});

type CodexTokens = Static<typeof codexTokens>;

/**
 * Codex reports `input_tokens` inclusive of the cached and freshly written
 * portions, so the uncached remainder is what is left after removing them.
 * Reasoning is reported inside `output_tokens` and is not added again.
 */
function codexUsage(raw: CodexTokens): Usage {
  const input = raw.input_tokens ?? 0;
  const cacheRead = raw.cached_input_tokens ?? 0;
  const cacheWrite = raw.cache_write_input_tokens ?? 0;
  const output = raw.output_tokens ?? 0;
  const uncached = Math.max(0, input - cacheRead - cacheWrite);

  return {
    ...emptyUsageSummary().total,
    input: uncached,
    output,
    cacheRead,
    cacheWrite,
    reasoning: Math.min(output, raw.reasoning_output_tokens ?? 0),
    totalTokens: uncached + output + cacheRead + cacheWrite,
  };
}

/**
 * A forked rollout's copied prologue is written in one synchronous burst, while
 * the child's own first response only lands after a real model turn. A second
 * of separation splits them; `ccusage` draws the line in the same place.
 */
const FORK_COPY_MAX_GAP_MS = 1000;

function parseMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function readCodexUsage(options: CodexUsageOptions): Promise<CodexUsage> {
  options.signal?.throwIfAborted();

  const home = resolve(
    options.homeDir ?? (process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")),
  );

  // Archived rollouts are history too, and they are where the legacy format lives.
  const roots = [join(home, "sessions"), join(home, "archived_sessions")];
  const present: string[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;

    try {
      if ((await stat(root)).isDirectory()) present.push(root);
    } catch {
      options.signal?.throwIfAborted();

      return { kind: "failed", message: "Could not open Codex local history." };
    }
  }

  if (present.length === 0) return { kind: "missing" };

  // `response_id` is unique across files, so a forked rollout that repeats its
  // parent's responses is deduplicated by the same map that dedups within one.
  const responses = new Map<string, CodexRow>();
  const legacy: CodexRow[] = [];
  const seen = new Set<string>();
  let malformedRecords = 0;
  let unreadableFiles = 0;

  try {
    for (const root of present) {
      for await (const path of jsonlFiles(root, options.signal)) {
        try {
          const scan = await scanCached(path, options.cache, seen, () =>
            scanCodexRollout(path, options.signal),
          );

          malformedRecords += scan.malformedRecords;

          // The legacy event is still written beside the modern record, so a
          // file that has both must be counted only once.
          if (scan.modern.length > 0) {
            for (const [id, row] of scan.modern) if (!responses.has(id)) responses.set(id, row);
          } else {
            legacy.push(...scan.legacy);
          }
        } catch {
          options.signal?.throwIfAborted();
          unreadableFiles++;
        }
      }
    }

    options.signal?.throwIfAborted();
    pruneCache(options.cache, seen);

    // Codex writes the ChatGPT-backend model ids, which is the `openai-codex`
    // provider's catalog, not the API provider's.
    const catalog = options.models
      .getModels("openai-codex")
      .filter((model) => model.provider === "openai-codex");

    const rows: ModelUsage[] = [];
    let unpricedRecords = 0;

    for (const row of [...responses.values(), ...legacy]) {
      options.signal?.throwIfAborted();
      // Priced on a copy: the cached usage outlives this read and this catalog.
      const usage: Usage = { ...row.usage, cost: { ...row.usage.cost } };
      const matches = catalog.filter((model) => model.id === row.model);
      const model = matches.length === 1 ? matches[0] : undefined;

      if (model) calculateCost(model, usage);
      else unpricedRecords++;
      rows.push({ provider: "openai-codex", model: row.model, turns: 1, usage });
    }

    return {
      kind: "ready",
      summary: mergeUsageSummaries(emptyUsageSummary(), { ...emptyUsageSummary(), models: rows }),
      unpricedRecords,
      malformedRecords,
      unreadableFiles,
    };
  } catch {
    options.signal?.throwIfAborted();

    return { kind: "failed", message: "Could not read Codex local history." };
  }
}

/** One rollout, read once, yielding whichever format it turns out to carry. */
async function scanCodexRollout(
  path: string,
  signal: AbortSignal | undefined,
): Promise<CodexFileScan> {
  const modern = new Map<string, CodexRow>();
  const legacy: CodexRow[] = [];
  let malformedRecords = 0;
  // `token_count` carries no model of its own; the last `turn_context` names it.
  let model = "";
  let sawMeta = false;
  let signature: string | undefined;
  let forkAnchorMs: number | undefined;

  for await (const line of historyLines(path, signal)) {
    signal?.throwIfAborted();

    if (!line.text.trim()) continue;
    let value: unknown;

    try {
      value = JSON.parse(line.text);
    } catch {
      if (line.terminated) malformedRecords++;
      continue;
    }

    if (!Value.Check(envelope, value)) {
      malformedRecords++;
      continue;
    }

    if (Value.Check(turnContext, value)) {
      if (value.payload.model !== undefined) model = value.payload.model;
      continue;
    }

    if (Value.Check(sessionMeta, value)) {
      // Only the first meta describes this file. A fork repeats its ancestors'
      // metas straight after, and letting those through would move the anchor.
      if (sawMeta) continue;
      sawMeta = true;

      const forked =
        value.payload.forked_from_id !== undefined || value.payload.parent_thread_id !== undefined;

      if (forked) forkAnchorMs = parseMs(value.timestamp);
      continue;
    }

    if (Value.Check(usageRecord, value)) {
      const id = value.payload.response_id;

      if (id === undefined || model === "") continue;
      const usage = codexUsage(value.payload.usage);

      if (usage.totalTokens > 0 && !modern.has(id)) modern.set(id, { model, usage });
      continue;
    }

    if (!Value.Check(tokenCount, value)) continue;
    const last = value.payload.info.last_token_usage;

    if (last === undefined || model === "") continue;
    // Codex re-emits an unchanged token_count on some stream boundaries.
    const next = JSON.stringify(last);

    if (next === signature) continue;
    signature = next;

    if (forkAnchorMs !== undefined) {
      const at = parseMs(value.timestamp);

      if (at !== undefined && at - forkAnchorMs < FORK_COPY_MAX_GAP_MS) {
        forkAnchorMs = at;
        continue;
      }

      forkAnchorMs = undefined;
    }

    const usage = codexUsage(last);

    if (usage.totalTokens > 0) legacy.push({ model, usage });
  }

  return { modern: [...modern], legacy, malformedRecords };
}

/** Every `.jsonl` under a root, following the root but not links beneath it. */
async function* jsonlFiles(root: string, signal: AbortSignal | undefined): AsyncGenerator<string> {
  const directories = [root];

  for (const directory of directories) {
    signal?.throwIfAborted();

    try {
      if (directory !== root && (await lstat(directory)).isSymbolicLink()) continue;

      for await (const entry of await opendir(directory)) {
        signal?.throwIfAborted();
        const path = join(directory, entry.name);

        if (entry.isDirectory()) directories.push(path);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
      }
    } catch (error) {
      if (directory === root) throw error;
    }
  }
}

/** Bounded reads preserve UTF-8 and distinguish an unfinished tail from complete JSONL lines. */
async function* historyLines(path: string, signal: AbortSignal | undefined) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const stat = await file.stat();

    if (!stat.isFile()) throw new Error("History is not a regular file.");
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let position = 0;

    // Stop at the size observed on open, even if Claude keeps appending.
    while (position < stat.size) {
      signal?.throwIfAborted();

      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - position),
        position,
      );

      if (bytesRead === 0) break;
      position += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));
      let start = 0;

      for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n", start)) {
        yield { text: pending.slice(start, end), terminated: true };
        start = end + 1;
      }

      pending = pending.slice(start);
    }

    pending += decoder.end();

    if (pending) yield { text: pending, terminated: false };
  } finally {
    await file.close();
  }
}

/**
 * Both readers' caches, persisted together so a restart pays stat calls
 * instead of a cold parse. Rows are positional: an all-time cache holds one
 * row per model response, and objects with keys would triple the file.
 */
export interface UsageScanCaches {
  readonly claudeCode: UsageScanCache<ClaudeCodeFileScan>;
  readonly codex: UsageScanCache<CodexFileScan>;
}

export function createUsageScanCaches(): UsageScanCaches {
  return { claudeCode: new Map(), codex: new Map() };
}

// v1: first persisted shape.
const USAGE_SCAN_CACHE_VERSION = 1;

const cachedTokens = Type.Number({ minimum: 0 });

const nullableTokens = Type.Union([cachedTokens, Type.Null()]);

/** model, input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning, costUSD. */
const usageRow = Type.Tuple([
  Type.String(),
  cachedTokens,
  cachedTokens,
  cachedTokens,
  cachedTokens,
  nullableTokens,
  nullableTokens,
  Type.Union([reportedCost, Type.Null()]),
]);

const fileScan = <T extends ReturnType<typeof Type.Object>>(scan: T) =>
  Type.Object({ size: cachedTokens, mtimeMs: Type.Number(), scan });

const scanCacheFile = Type.Object({
  version: Type.Literal(USAGE_SCAN_CACHE_VERSION),
  claudeCode: Type.Record(
    Type.String(),
    fileScan(
      Type.Object({
        keyed: Type.Array(Type.Tuple([Type.String(), usageRow])),
        anonymous: Type.Array(usageRow),
        malformedRecords: cachedTokens,
      }),
    ),
  ),
  codex: Type.Record(
    Type.String(),
    fileScan(
      Type.Object({
        modern: Type.Array(Type.Tuple([Type.String(), usageRow])),
        legacy: Type.Array(usageRow),
        malformedRecords: cachedTokens,
      }),
    ),
  ),
});

type UsageRow = Static<typeof usageRow>;

function encodeRow(model: string, usage: Usage, costUSD: number | undefined): UsageRow {
  return [
    model,
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.cacheWrite1h ?? null,
    usage.reasoning ?? null,
    costUSD ?? null,
  ];
}

function decodeRow(row: UsageRow): Snapshot {
  const [model, input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning, costUSD] = row;

  const usage: Usage = {
    ...emptyUsageSummary().total,
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
  };

  if (cacheWrite1h !== null) usage.cacheWrite1h = cacheWrite1h;

  if (reasoning !== null) usage.reasoning = reasoning;

  return { model, usage, costUSD: costUSD ?? undefined };
}

export function encodeUsageScanCaches(caches: UsageScanCaches): string {
  const claudeCode: Record<string, Static<typeof scanCacheFile>["claudeCode"][string]> = {};

  for (const [path, entry] of caches.claudeCode) {
    claudeCode[path] = {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      scan: {
        keyed: entry.scan.keyed.map(([identity, snapshot]) => [
          identity,
          encodeRow(snapshot.model, snapshot.usage, snapshot.costUSD),
        ]),
        anonymous: entry.scan.anonymous.map((snapshot) =>
          encodeRow(snapshot.model, snapshot.usage, snapshot.costUSD),
        ),
        malformedRecords: entry.scan.malformedRecords,
      },
    };
  }

  const codex: Record<string, Static<typeof scanCacheFile>["codex"][string]> = {};

  for (const [path, entry] of caches.codex) {
    codex[path] = {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      scan: {
        modern: entry.scan.modern.map(([id, row]) => [
          id,
          encodeRow(row.model, row.usage, undefined),
        ]),
        legacy: entry.scan.legacy.map((row) => encodeRow(row.model, row.usage, undefined)),
        malformedRecords: entry.scan.malformedRecords,
      },
    };
  }

  return JSON.stringify({
    version: USAGE_SCAN_CACHE_VERSION,
    claudeCode,
    codex,
  } satisfies Static<typeof scanCacheFile>);
}

/** Anything but a whole, current cache decodes to empty: a cold read, never a wrong one. */
export function decodeUsageScanCaches(text: string): UsageScanCaches {
  const caches = createUsageScanCaches();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return caches;
  }

  if (!Value.Check(scanCacheFile, parsed)) return caches;

  for (const [path, entry] of Object.entries(parsed.claudeCode)) {
    caches.claudeCode.set(path, {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      scan: {
        keyed: entry.scan.keyed.map(([identity, row]) => [identity, decodeRow(row)]),
        anonymous: entry.scan.anonymous.map(decodeRow),
        malformedRecords: entry.scan.malformedRecords,
      },
    });
  }

  for (const [path, entry] of Object.entries(parsed.codex)) {
    caches.codex.set(path, {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      scan: {
        modern: entry.scan.modern.map(([id, row]) => {
          const { model, usage } = decodeRow(row);

          return [id, { model, usage }];
        }),
        legacy: entry.scan.legacy.map((row) => {
          const { model, usage } = decodeRow(row);

          return { model, usage };
        }),
        malformedRecords: entry.scan.malformedRecords,
      },
    });
  }

  return caches;
}

/** Both local tools use the same result shape and remain separate from Nyte totals. */
export interface LocalUsage {
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

/** Read recorded consumption only; a failed tool does not hide the other tool's history. */
export async function readLocalUsage(options: {
  readonly models: Pick<Models, "getModels">;
  readonly signal?: AbortSignal;
  readonly caches?: UsageScanCaches;
}): Promise<LocalUsage> {
  const failed = (message: string): LocalHistoryUsage => {
    options.signal?.throwIfAborted();

    return { kind: "failed", message };
  };

  const [claudeCode, codex] = await Promise.all([
    readClaudeCodeUsage({
      models: options.models,
      signal: options.signal,
      cache: options.caches?.claudeCode,
    }).catch(() => failed("Could not read Claude Code history.")),
    readCodexUsage({
      models: options.models,
      signal: options.signal,
      cache: options.caches?.codex,
    }).catch(() => failed("Could not read Codex history.")),
  ]);

  options.signal?.throwIfAborted();

  return { claudeCode, codex };
}

/** Account windows are separate from measured tokens and estimated API cost. */
export type AccountUsage = {
  readonly provider: "anthropic" | "openai-codex";
} & (
  | { readonly kind: "ready"; readonly limits: AccountLimits }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly message: string }
);

/** Read the account signed into Nyte using the existing provider authentication. */
export async function readAccountUsage(options: {
  readonly models: Models;
  readonly provider: AccountUsage["provider"];
  readonly signal: AbortSignal;
}): Promise<AccountUsage> {
  const { models, provider, signal } = options;

  try {
    const model = models
      .getModels(provider)
      .find((candidate) =>
        provider === "anthropic"
          ? hasApi(candidate, "anthropic-messages")
          : hasApi(candidate, "openai-codex-responses"),
      );

    if (model === undefined) return { provider, kind: "unavailable" };
    const auth = await models.getAuth(model, { signal });
    const apiKey = auth?.auth.apiKey;

    if (apiKey === undefined || (provider === "anthropic" && !apiKey.includes("sk-ant-oat"))) {
      return { provider, kind: "unavailable" };
    }

    const request = { apiKey, headers: auth?.auth.headers, signal, timeoutMs: 10_000 };
    const selected = { ...model, baseUrl: auth?.auth.baseUrl ?? model.baseUrl };

    const limits = hasApi(selected, "anthropic-messages")
      ? await fetchAnthropicAccountLimits(selected, request)
      : hasApi(selected, "openai-codex-responses")
        ? await fetchOpenAICodexAccountLimits(selected, request)
        : undefined;

    return limits === undefined || limits.windows.length === 0
      ? { provider, kind: "unavailable" }
      : { provider, kind: "ready", limits };
  } catch {
    if (
      signal.aborted &&
      !(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError")
    ) {
      signal.throwIfAborted();
    }

    return { provider, kind: "failed", message: "Could not read account limits. Try again." };
  }
}
