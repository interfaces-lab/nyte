import { Buffer } from "node:buffer";
import { constants, existsSync } from "node:fs";
import { lstat, open, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { calculateCost, type Models } from "@nyte-ai/ai";
import { summarizeModels, emptyModelUsage, recordedUsage } from "./usage-summary.ts";
import type { LocalHistoryUsage, ModelUsage } from "./usage-types.ts";
import type { Usage } from "@nyte-ai/schema/model";

export interface ClaudeCodeUsageOptions {
  readonly models: Pick<Models, "getModels">;
  readonly configDir?: string;
  readonly signal?: AbortSignal;
  readonly cache?: UsageScanCache<ClaudeCodeFileScan>;
}

export type UsageScanCache<T> = Map<string, FileScan<T>>;

export interface FileScan<T> {
  readonly size: number;
  readonly mtimeMs: number;
  readonly scan: T;
}

export interface ClaudeCodeFileScan {
  readonly keyed: readonly (readonly [string, Snapshot])[];
  readonly anonymous: readonly Snapshot[];
  readonly malformedRecords: number;
}

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

/** Reads one Claude Code transcript's usage snapshots. An unparsable last line without its newline is not counted malformed: a writer may still be appending it. */
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
      ...emptyModelUsage(),
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

function pruneCache<T>(cache: UsageScanCache<T> | undefined, seen: Set<string>): void {
  if (cache === undefined) return;

  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
}

/**
 * Reads Claude Code's local usage under `<configDir>/projects`. The configured root may be a
 * symlink (as may a system ancestor such as macOS `/tmp`), but links below it are skipped, to
 * avoid loops and duplicate history. Every read prices cached snapshots again on a copy, since
 * the catalog can change between reads while a transcript does not; a snapshot that records its
 * own cost keeps that total, with no invented breakdown.
 */
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
      const usage: Usage = { ...snapshot.usage, cost: { ...snapshot.usage.cost } };

      if (snapshot.costUSD !== undefined) {
        usage.cost.total = snapshot.costUSD;
      } else {
        const matches = catalog.filter((model) => model.id === snapshot.model);
        const model = matches.length === 1 ? matches[0] : undefined;

        if (model) calculateCost(model, usage);
        else unpricedRecords++;
      }

      rows.push({
        provider: "anthropic",
        model: snapshot.model,
        turns: 1,
        usage: recordedUsage(usage),
      });
    }

    options.signal?.throwIfAborted();

    return {
      kind: "ready",
      summary: summarizeModels(rows),
      unpricedRecords,
      malformedRecords,
      unreadableFiles,
    };
  } catch {
    options.signal?.throwIfAborted();

    return { kind: "failed", message: "Could not read Claude Code local history." };
  }
}

export type CodexUsage = LocalHistoryUsage;

export interface CodexUsageOptions {
  readonly models: Pick<Models, "getModels">;
  readonly homeDir?: string;
  readonly signal?: AbortSignal;
  readonly cache?: UsageScanCache<CodexFileScan>;
}

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

function codexUsage(raw: CodexTokens): Usage {
  const input = raw.input_tokens ?? 0;
  const cacheRead = raw.cached_input_tokens ?? 0;
  const cacheWrite = raw.cache_write_input_tokens ?? 0;
  const output = raw.output_tokens ?? 0;
  const uncached = Math.max(0, input - cacheRead - cacheWrite);

  return {
    ...emptyModelUsage(),
    input: uncached,
    output,
    cacheRead,
    cacheWrite,
    reasoning: Math.min(output, raw.reasoning_output_tokens ?? 0),
    totalTokens: uncached + output + cacheRead + cacheWrite,
  };
}

const FORK_COPY_MAX_GAP_MS = 1000;

function parseMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Reads Codex's local usage from `sessions` and `archived_sessions` (where the legacy format
 * lives). A `response_id` is unique across files, so one map dedups a forked rollout's repeated
 * parent responses as well as repeats within a file; a file with modern records counts only
 * those, since the legacy event is written beside them. Rows are priced on a copy against the
 * `openai-codex` catalog, the ChatGPT-backend model ids Codex writes.
 */
export async function readCodexUsage(options: CodexUsageOptions): Promise<CodexUsage> {
  options.signal?.throwIfAborted();

  const home = resolve(
    options.homeDir ?? (process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")),
  );

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

    const catalog = options.models
      .getModels("openai-codex")
      .filter((model) => model.provider === "openai-codex");

    const rows: ModelUsage[] = [];
    let unpricedRecords = 0;

    for (const row of [...responses.values(), ...legacy]) {
      options.signal?.throwIfAborted();
      const usage: Usage = { ...row.usage, cost: { ...row.usage.cost } };
      const matches = catalog.filter((model) => model.id === row.model);
      const model = matches.length === 1 ? matches[0] : undefined;

      if (model) calculateCost(model, usage);
      else unpricedRecords++;
      rows.push({
        provider: "openai-codex",
        model: row.model,
        turns: 1,
        usage: recordedUsage(usage),
      });
    }

    return {
      kind: "ready",
      summary: summarizeModels(rows),
      unpricedRecords,
      malformedRecords,
      unreadableFiles,
    };
  } catch {
    options.signal?.throwIfAborted();

    return { kind: "failed", message: "Could not read Codex local history." };
  }
}

/**
 * Reads one Codex rollout. A `token_count` names no model, so the last `turn_context` does; only
 * the file's first session meta counts, since a fork repeats its ancestors' metas straight after
 * and would move the fork anchor; and a `token_count` equal to the one before is a re-emission
 * at a stream boundary, not new usage.
 */
async function scanCodexRollout(
  path: string,
  signal: AbortSignal | undefined,
): Promise<CodexFileScan> {
  const modern = new Map<string, CodexRow>();
  const legacy: CodexRow[] = [];
  let malformedRecords = 0;
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

/** Yields a history file's lines up to the size it had when opened, though its writer may keep appending; the last line is `terminated: false` without its newline. */
async function* historyLines(path: string, signal: AbortSignal | undefined) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const stat = await file.stat();

    if (!stat.isFile()) throw new Error("History is not a regular file.");
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let position = 0;

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
      const lines = `${pending}${decoder.write(buffer.subarray(0, bytesRead))}`.split("\n");
      pending = lines.pop() ?? "";

      for (const text of lines) yield { text, terminated: true };
    }

    pending += decoder.end();

    if (pending) yield { text: pending, terminated: false };
  } finally {
    await file.close();
  }
}

export interface UsageScanCaches {
  readonly claudeCode: UsageScanCache<ClaudeCodeFileScan>;
  readonly codex: UsageScanCache<CodexFileScan>;
}

export function createUsageScanCaches(): UsageScanCaches {
  return { claudeCode: new Map(), codex: new Map() };
}

export interface LocalUsage {
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

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
