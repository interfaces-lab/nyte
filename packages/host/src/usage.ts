import { existsSync } from "node:fs";
import { lstat, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { calculateCost, type Models } from "@nyte-ai/ai";
import { localDay } from "./store-usage.ts";
import {
  fileScanSchema,
  readCacheDocument,
  readHistory,
  UsageScanCache,
  writeCacheDocument,
  type HistoryLine,
  type HistoryParser,
} from "./usage-history.ts";
import { summarizeModels, emptyModelUsage, recordedUsage } from "./usage-summary.ts";
import type { LocalHistoryUsage, ModelUsage, UsageWindow } from "./usage-types.ts";
import type { Usage } from "@nyte-ai/schema/model";

export interface ClaudeCodeUsageOptions {
  readonly models: Pick<Models, "getModels">;
  readonly window: UsageWindow;
  readonly configDir?: string;
  readonly signal?: AbortSignal;
  readonly cache?: UsageScanCache<ClaudeCodeFileScan>;
}

export type ClaudeCodeUsage = LocalHistoryUsage;

const tokens = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

const count = Type.Number({ minimum: 0 });

const modelUsage = Type.Object({
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
  cacheWrite1h: Type.Optional(count),
  reasoning: Type.Optional(count),
  totalTokens: count,
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    total: Type.Number(),
  }),
});

/** When a record was written, in epoch ms; `null` when its line carries no readable timestamp. */
const recordedAt = Type.Union([Type.Number(), Type.Null()]);

const snapshot = Type.Object({
  model: Type.String(),
  usage: modelUsage,
  costUSD: Type.Optional(Type.Number()),
  at: recordedAt,
});

export type Snapshot = Static<typeof snapshot>;

const claudeCodeFileScan = Type.Object({
  keyed: Type.Array(Type.Tuple([Type.String(), snapshot])),
  anonymous: Type.Array(snapshot),
  malformedRecords: Type.Integer({ minimum: 0 }),
});

export type ClaudeCodeFileScan = Static<typeof claudeCodeFileScan>;

const envelope = Type.Object({ type: Type.String() });

const assistantRecord = Type.Object({
  type: Type.Literal("assistant"),
  timestamp: Type.Optional(Type.String()),
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

function parseRecordedAt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

/** Whether a record falls in `window`, by the host's local day. An undated record counts only toward all time. */
function recordedIn(window: UsageWindow, at: number | null): boolean {
  if (at === null) return window.sinceDay === null;
  const day = localDay(at);

  return day <= window.untilDay && (window.sinceDay === null || day >= window.sinceDay);
}

/** Folds Claude Code transcript lines into usage snapshots. An unparsable last line without its newline is not counted malformed: a writer may still be appending it. */
const claudeCodeParser: HistoryParser<ClaudeCodeFileScan> = (from) => {
  const keyed = new Map(from?.keyed);
  const anonymous = [...(from?.anonymous ?? [])];
  let malformedRecords = from?.malformedRecords ?? 0;

  const line = ({ text, terminated }: HistoryLine): void => {
    if (!text.trim()) return;
    let value: unknown;

    try {
      value = JSON.parse(text);
    } catch {
      if (terminated) malformedRecords++;

      return;
    }

    if (!Value.Check(envelope, value)) {
      malformedRecords++;

      return;
    }

    if (value.type !== "assistant") return;

    if (!Value.Check(assistantRecord, value)) {
      malformedRecords++;

      return;
    }

    const raw = value.message.usage;
    const cacheWrite = raw.cache_creation_input_tokens ?? 0;
    const cacheWrite1h = raw.cache_creation?.ephemeral_1h_input_tokens;

    if ((cacheWrite1h ?? 0) + (raw.cache_creation?.ephemeral_5m_input_tokens ?? 0) > cacheWrite) {
      malformedRecords++;

      return;
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
      at: parseRecordedAt(value.timestamp),
    };

    if (Value.Check(reportedCost, value.costUSD)) snapshot.costUSD = value.costUSD;

    const messageId = value.message.id?.trim() || null;
    const requestId = value.requestId?.trim() || null;

    if (messageId === null && requestId === null) {
      anonymous.push(snapshot);

      return;
    }

    const identity = JSON.stringify([messageId, requestId]);

    if (betterSnapshot(keyed.get(identity), snapshot)) keyed.set(identity, snapshot);
  };

  return { line, scan: () => ({ keyed: [...keyed], anonymous: [...anonymous], malformedRecords }) };
};

/**
 * Reads one history file unless it was last written before `window` opens: no record is dated
 * after its file's last write. The path counts as seen either way, so the cache keeps a file the
 * window passes over.
 */
async function readHistoryInWindow<Scan>(
  path: string,
  window: UsageWindow,
  read: {
    readonly parser: HistoryParser<Scan>;
    readonly cache: UsageScanCache<Scan> | undefined;
    readonly seen: Set<string>;
    readonly signal: AbortSignal | undefined;
  },
): Promise<Scan | undefined> {
  read.seen.add(path);
  const info = await lstat(path);

  if (!info.isFile()) throw new Error("History is not a regular file.");

  const opens = window.sinceDay === null ? 0 : new Date(`${window.sinceDay}T00:00:00`).getTime();

  if (info.mtimeMs < opens) return undefined;

  return readHistory(path, info, read.parser, read.cache, read.signal);
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
            const scan = await readHistoryInWindow(path, options.window, {
              parser: claudeCodeParser,
              cache: options.cache,
              seen,
              signal: options.signal,
            });

            if (scan === undefined) continue;
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
    options.cache?.keepOnly(seen);

    const catalog = options.models
      .getModels("anthropic")
      .filter((model) => model.provider === "anthropic");

    const rows: ModelUsage[] = [];
    let unpricedRecords = 0;

    for (const snapshot of [...keyed.values(), ...anonymous]) {
      options.signal?.throwIfAborted();

      if (!recordedIn(options.window, snapshot.at)) continue;
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
  readonly window: UsageWindow;
  readonly homeDir?: string;
  readonly signal?: AbortSignal;
  readonly cache?: UsageScanCache<CodexFileScan>;
}

const codexRow = Type.Object({ model: Type.String(), usage: modelUsage, at: recordedAt });

export type CodexRow = Static<typeof codexRow>;

/** What a rollout's next line is read against: see {@link codexParser}. */
const codexCursor = Type.Object({
  model: Type.String(),
  sawMeta: Type.Boolean(),
  signature: Type.Optional(Type.String()),
  forkAnchorMs: Type.Optional(Type.Number()),
});

const codexFileScan = Type.Object({
  modern: Type.Array(Type.Tuple([Type.String(), codexRow])),
  legacy: Type.Array(codexRow),
  malformedRecords: Type.Integer({ minimum: 0 }),
  cursor: codexCursor,
});

export type CodexFileScan = Static<typeof codexFileScan>;

const codexTokens = Type.Object({
  input_tokens: Type.Optional(tokens),
  cached_input_tokens: Type.Optional(tokens),
  cache_write_input_tokens: Type.Optional(tokens),
  output_tokens: Type.Optional(tokens),
  reasoning_output_tokens: Type.Optional(tokens),
});

const usageRecord = Type.Object({
  type: Type.Literal("token_usage_record"),
  timestamp: Type.Optional(Type.String()),
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
          const scan = await readHistoryInWindow(path, options.window, {
            parser: codexParser,
            cache: options.cache,
            seen,
            signal: options.signal,
          });

          if (scan === undefined) continue;
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
    options.cache?.keepOnly(seen);

    const catalog = options.models
      .getModels("openai-codex")
      .filter((model) => model.provider === "openai-codex");

    const rows: ModelUsage[] = [];
    let unpricedRecords = 0;

    for (const row of [...responses.values(), ...legacy]) {
      options.signal?.throwIfAborted();

      if (!recordedIn(options.window, row.at)) continue;
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
 * Folds one Codex rollout. A `token_count` names no model, so the last `turn_context` does; only
 * the file's first session meta counts, since a fork repeats its ancestors' metas straight after
 * and would move the fork anchor; and a `token_count` equal to the one before is a re-emission
 * at a stream boundary, not new usage. That reading state is the scan's cursor, so a grown
 * rollout resumes against it.
 */
const codexParser: HistoryParser<CodexFileScan> = (from) => {
  const modern = new Map(from?.modern);
  const legacy = [...(from?.legacy ?? [])];
  let malformedRecords = from?.malformedRecords ?? 0;
  const cursor: CodexFileScan["cursor"] = { ...(from?.cursor ?? { model: "", sawMeta: false }) };

  const line = ({ text, terminated }: HistoryLine): void => {
    if (!text.trim()) return;
    let value: unknown;

    try {
      value = JSON.parse(text);
    } catch {
      if (terminated) malformedRecords++;

      return;
    }

    if (!Value.Check(envelope, value)) {
      malformedRecords++;

      return;
    }

    if (Value.Check(turnContext, value)) {
      if (value.payload.model !== undefined) cursor.model = value.payload.model;

      return;
    }

    if (Value.Check(sessionMeta, value)) {
      if (cursor.sawMeta) return;
      cursor.sawMeta = true;

      const forked =
        value.payload.forked_from_id !== undefined || value.payload.parent_thread_id !== undefined;

      const anchor = parseRecordedAt(value.timestamp);

      if (forked && anchor !== null) cursor.forkAnchorMs = anchor;

      return;
    }

    if (Value.Check(usageRecord, value)) {
      const id = value.payload.response_id;

      if (id === undefined || cursor.model === "") return;
      const usage = codexUsage(value.payload.usage);

      if (usage.totalTokens > 0 && !modern.has(id))
        modern.set(id, { model: cursor.model, usage, at: parseRecordedAt(value.timestamp) });

      return;
    }

    if (!Value.Check(tokenCount, value)) return;
    const last = value.payload.info.last_token_usage;

    if (last === undefined || cursor.model === "") return;
    const next = JSON.stringify(last);

    if (next === cursor.signature) return;
    cursor.signature = next;
    const at = parseRecordedAt(value.timestamp);

    if (cursor.forkAnchorMs !== undefined) {
      if (at !== null && at - cursor.forkAnchorMs < FORK_COPY_MAX_GAP_MS) {
        cursor.forkAnchorMs = at;

        return;
      }

      delete cursor.forkAnchorMs;
    }

    const usage = codexUsage(last);

    if (usage.totalTokens > 0) legacy.push({ model: cursor.model, usage, at });
  };

  return {
    line,
    scan: () => ({
      modern: [...modern],
      legacy: [...legacy],
      malformedRecords,
      cursor: { ...cursor },
    }),
  };
};

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

export interface UsageScanCaches {
  readonly claudeCode: UsageScanCache<ClaudeCodeFileScan>;
  readonly codex: UsageScanCache<CodexFileScan>;
}

export function createUsageScanCaches(): UsageScanCaches {
  return { claudeCode: new UsageScanCache(), codex: new UsageScanCache() };
}

/** Bump when a parser changes what it keeps, so an older document is dropped instead of misread. */
const USAGE_SCAN_CACHE_VERSION = 1;

const usageScanCacheDocument = Type.Object({
  version: Type.Literal(USAGE_SCAN_CACHE_VERSION),
  claudeCode: Type.Array(Type.Tuple([Type.String(), fileScanSchema(claudeCodeFileScan)])),
  codex: Type.Array(Type.Tuple([Type.String(), fileScanSchema(codexFileScan)])),
});

const usageScanCacheValidator = Compile(usageScanCacheDocument);

/** Restores the scans {@link saveUsageScanCaches} wrote to `path`; each still answers only while its file is unchanged. */
export async function loadUsageScanCaches(path: string): Promise<UsageScanCaches> {
  const document = await readCacheDocument(path, usageScanCacheValidator);

  if (document === undefined) return createUsageScanCaches();

  return {
    claudeCode: new UsageScanCache(document.claudeCode),
    codex: new UsageScanCache(document.codex),
  };
}

/** Writes `caches` to `path` when a read changed them since they were last saved; a failed write is tried again on the next save. */
export async function saveUsageScanCaches(path: string, caches: UsageScanCaches): Promise<void> {
  if (!caches.claudeCode.changed && !caches.codex.changed) return;

  const saved = await writeCacheDocument(path, {
    version: USAGE_SCAN_CACHE_VERSION,
    claudeCode: [...caches.claudeCode.entries()],
    codex: [...caches.codex.entries()],
  } satisfies Static<typeof usageScanCacheDocument>);

  if (!saved) return;
  caches.claudeCode.markSaved();
  caches.codex.markSaved();
}

export interface LocalUsage {
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

export async function readLocalUsage(options: {
  readonly models: Pick<Models, "getModels">;
  readonly window: UsageWindow;
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
      window: options.window,
      signal: options.signal,
      cache: options.caches?.claudeCode,
    }).catch(() => failed("Could not read Claude Code history.")),
    readCodexUsage({
      models: options.models,
      window: options.window,
      signal: options.signal,
      cache: options.caches?.codex,
    }).catch(() => failed("Could not read Codex history.")),
  ]);

  options.signal?.throwIfAborted();

  return { claudeCode, codex };
}
