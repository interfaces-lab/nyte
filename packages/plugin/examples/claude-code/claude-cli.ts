import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { registerSessionResourceCleanup } from "@nyte-ai/ai";
import { usageCreditsAllowed, usageCreditsChargeError } from "./billing.ts";
import type { RateLimitInfo } from "./billing.ts";
import { INERT_MCP_SOURCE } from "./inert-mcp.ts";
import {
  configuredCommand,
  childExit,
  killProcessTree,
  processEnvironment,
  readyClaudeCommand,
  spawnCommand,
} from "./process.ts";
import {
  deriveInitialSystemMessages,
  deriveInitialUserPrefix,
  rewriteInitialRequest,
} from "./replay.ts";
import { TurnRelay } from "./turn-relay.ts";
import { matchesRecord, parseOutputEvent } from "./wire.ts";
import type {
  AnthropicStreamEvent,
  JsonRecord,
  NativeFrame,
  NativeMessage,
  NativeOutputEvent,
  NativeResult,
  NativeUsage,
} from "./wire.ts";
import { TOOL_PREFIX } from "./transcript.ts";
import type { NativeSystemInjection, ToolManifestEntry } from "./transcript.ts";

export interface RunClaudeInput {
  model: string;
  cwd?: string;
  frames: NativeFrame[];
  systemPrompt: string;
  manifest: ToolManifestEntry[];
  extraBody: JsonRecord;
  toolNames: Set<string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  upstreamUrl?: string;
  initialUserPrefix?: unknown[];
  initialSystemMessages?: unknown[];
  nativeSystemInjections?: NativeSystemInjection[];
  betas?: string[];
  onEvent?: (event: AnthropicStreamEvent) => void;
  sessionId?: string;
}

export interface RunClaudeOutput {
  message: NativeMessage;
  usage: NativeUsage;
  relay: {
    upstreamRequests: number;
    blockedRequests: number;
    requestId?: string;
  };
  initialUserPrefix?: unknown[];
  initialSystemMessages?: unknown[];
  rateLimit?: RateLimitInfo;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;
  private failure?: Error;

  push(value: T): void {
    const waiter = this.waiters.shift();

    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(error?: Error): void {
    this.ended = true;
    this.failure = error;

    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async next(signal: AbortSignal | undefined, timeoutMs: number): Promise<T | undefined> {
    if (this.values.length) return this.values.shift();

    if (this.ended) {
      if (this.failure) throw this.failure;

      return undefined;
    }

    signal?.throwIfAborted();

    return new Promise<T | undefined>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const index = this.waiters.findIndex((pending) => pending === waiter);

        if (index >= 0) this.waiters.splice(index, 1);
        fn();
      };

      const waiter = (item: IteratorResult<T>) =>
        finish(() => {
          if (item.done && this.failure) reject(this.failure);
          else resolve(item.done ? undefined : item.value);
        });

      const onAbort = () =>
        finish(() => reject(signal?.reason ?? new Error("Claude Code request aborted")));

      const timer = setTimeout(
        () => finish(() => reject(new Error("Claude Code stream timed out"))),
        timeoutMs,
      );

      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

async function writeFrame(child: ChildProcess, frame: NativeFrame): Promise<void> {
  const input = child.stdin;

  if (!input?.writable) throw new Error("Claude Code stdin closed during history replay");

  if (!input.write(`${JSON.stringify(frame)}\n`)) {
    await new Promise<void>((resolve, reject) => {
      input.once("drain", resolve);
      input.once("error", reject);
    });
  }
}

function nativeErrorText(
  event: Extract<NativeOutputEvent, { type: "assistant" }>,
): string | undefined {
  const messageError = event.message.error;

  if (!event.error && !messageError) return undefined;

  return event.message.content
    .filter(
      (block): block is Extract<(typeof event.message.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

const CLAUDE_PROCESS_MAX_AGE_MS = 5 * 60 * 1_000;

const MAX_CACHED_CLAUDE_PROCESSES = 2;

interface ClaudeLaunchPlan {
  env: Record<string, string>;
  fingerprint: string;
  timeoutMs: number;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";

  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  if (!matchesRecord(value)) throw new Error("Expected a JSON value");

  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function frameHistoryHash(frames: NativeFrame[]): string {
  return digest(
    frames.map((frame) => ({
      type: frame.type,
      message: frame.message,
    })),
  );
}

function launchPlan(input: RunClaudeInput): ClaudeLaunchPlan {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const env = processEnvironment(input.env, input.extraBody);

  return {
    env,
    timeoutMs,
    fingerprint: digest({
      command: configuredCommand(env),
      cwd: resolvePath(input.cwd ?? process.cwd()),
      env,
      extraBody: input.extraBody,
      manifest: input.manifest,
      model: input.model,
      systemPrompt: input.systemPrompt,
      timeoutMs,
      upstreamUrl: input.upstreamUrl ?? "https://api.anthropic.com",
    }),
  };
}

class ClaudeProcess {
  busy = false;
  readonly createdAt = Date.now();
  lastUsed = this.createdAt;

  private tipHash?: string;
  private expiryTimer?: NodeJS.Timeout;
  private closed = false;
  private stderr = "";

  readonly fingerprint: string;
  private readonly root: string;
  private readonly child: ChildProcess;
  private readonly relay: TurnRelay;
  private readonly queue: AsyncQueue<NativeOutputEvent>;
  private readonly readTask: Promise<void>;
  private readonly exitOutcome: Promise<{ code?: number; error?: Error }>;
  private readonly timeoutMs: number;

  private constructor(
    fingerprint: string,
    root: string,
    child: ChildProcess,
    relay: TurnRelay,
    queue: AsyncQueue<NativeOutputEvent>,
    readTask: Promise<void>,
    exitOutcome: Promise<{ code?: number; error?: Error }>,
    timeoutMs: number,
  ) {
    this.fingerprint = fingerprint;
    this.root = root;
    this.child = child;
    this.relay = relay;
    this.queue = queue;
    this.readTask = readTask;
    this.exitOutcome = exitOutcome;
    this.timeoutMs = timeoutMs;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on(
      "data",
      (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-65_536)),
    );
  }

  static async create(input: RunClaudeInput, plan: ClaudeLaunchPlan): Promise<ClaudeProcess> {
    input.signal?.throwIfAborted();
    const command = await readyClaudeCommand({ ...process.env, ...input.env }, input.signal);

    const root = await mkdtemp(join(tmpdir(), "nyte-claude-code-"));
    const toolsPath = join(root, "tools.json");
    const settingsPath = join(root, "settings.json");
    const systemPath = join(root, "system.md");
    const inertMcpPath = join(root, "inert-mcp.mjs");
    let child: ChildProcess | undefined;
    let relay: TurnRelay | undefined;

    try {
      await Promise.all([
        writeFile(inertMcpPath, INERT_MCP_SOURCE, "utf8"),
        writeFile(toolsPath, JSON.stringify(input.manifest), "utf8"),
        writeFile(
          settingsPath,
          JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(input.extraBody) } }),
          "utf8",
        ),
        writeFile(systemPath, input.systemPrompt, "utf8"),
      ]);

      relay = new TurnRelay(input.upstreamUrl ?? "https://api.anthropic.com", plan.timeoutMs);
      const env = { ...plan.env, ANTHROPIC_BASE_URL: await relay.start() };

      const mcp = {
        mcpServers: {
          nyte: {
            command: process.versions.bun === undefined ? process.execPath : "node",
            args: [inertMcpPath, toolsPath],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      };

      const args = [
        "-p",
        "--model",
        input.model,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--system-prompt-file",
        systemPath,
        "--settings",
        settingsPath,
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--max-turns",
        "1",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
        "--mcp-config",
        JSON.stringify(mcp),
      ];

      child = spawnCommand(command, args, {
        cwd: input.cwd ?? process.cwd(),
        env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const queue = new AsyncQueue<NativeOutputEvent>();

      if (child.stdout === null) throw new Error("Claude Code stdout is unavailable");
      const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });

      const readTask = (async () => {
        try {
          for await (const line of reader) {
            if (!line.trim()) continue;

            try {
              const event = parseOutputEvent(line);

              if (event !== undefined) queue.push(event);
            } catch (error) {
              throw new Error(`Invalid Claude Code stream-json output: ${line.slice(0, 300)}`, {
                cause: error,
              });
            }
          }

          queue.end();
        } catch (error) {
          queue.end(error instanceof Error ? error : new Error(String(error)));
        }
      })();

      const exitOutcome = childExit(child).then(
        (code) => ({ code }),
        (error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) }),
      );

      return new ClaudeProcess(
        plan.fingerprint,
        root,
        child,
        relay,
        queue,
        readTask,
        exitOutcome,
        plan.timeoutMs,
      );
    } catch (error) {
      relay?.abort();

      if (child && child.exitCode === null) killProcessTree(child);
      await relay?.close();
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  isAlive(): boolean {
    return !this.closed && this.child.exitCode === null && !!this.child.stdin?.writable;
  }

  isExpired(now = Date.now()): boolean {
    return now - this.createdAt >= CLAUDE_PROCESS_MAX_AGE_MS;
  }

  canContinue(input: RunClaudeInput): boolean {
    if (!this.tipHash || input.frames.length === 0) return false;

    return frameHistoryHash(input.frames.slice(0, -1)) === this.tipHash;
  }

  clearExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  armExpiryTimer(expire: () => void): void {
    this.clearExpiryTimer();
    this.lastUsed = Date.now();
    const remainingLifetime = CLAUDE_PROCESS_MAX_AGE_MS - (this.lastUsed - this.createdAt);
    this.expiryTimer = setTimeout(expire, Math.max(0, remainingLifetime));
    this.expiryTimer.unref?.();
  }

  commit(input: RunClaudeInput, message: NativeMessage): boolean {
    if (message.content.some((block) => block.type === "tool_use")) {
      this.tipHash = undefined;

      return false;
    }

    this.tipHash = frameHistoryHash([
      ...input.frames,
      { type: "assistant", message: { role: "assistant", content: message.content } },
    ]);

    return true;
  }

  async run(input: RunClaudeInput, continuation: boolean): Promise<RunClaudeOutput> {
    if (!this.isAlive()) throw new Error("Claude Code process is no longer available");
    input.signal?.throwIfAborted();

    let sawMessageStop = false;

    const deliver = (event: AnthropicStreamEvent) => {
      if (event.type === "message_stop") sawMessageStop = true;
      input.onEvent?.(event);
    };

    const canonicalInitialUser =
      input.frames.find((frame) => frame.type === "user")?.message.content ?? [];

    this.relay.beginTurn(
      deliver,
      input.initialUserPrefix || input.initialSystemMessages || input.nativeSystemInjections
        ? (body) =>
            rewriteInitialRequest(
              body,
              input.initialUserPrefix,
              canonicalInitialUser,
              input.initialSystemMessages,
              input.nativeSystemInjections,
            )
        : undefined,
      input.betas,
    );

    const abort = () => {
      this.relay.abort();
      this.closeNow();
    };

    input.signal?.addEventListener("abort", abort, { once: true });
    const assistants: NativeMessage[] = [];
    let result: NativeResult | undefined;
    let nativeError: string | undefined;
    let rateLimit: RateLimitInfo | undefined;

    try {
      const frames = continuation ? input.frames.slice(-1) : input.frames;

      for (const frame of frames) {
        await writeFrame(this.child, frame);

        if (frame.shouldQuery === false) {
          for (;;) {
            const event = await this.queue.next(input.signal, this.timeoutMs);

            if (!event)
              throw await this.exitError("Claude Code exited before acknowledging history replay");

            if (event.type === "result") {
              if (event.num_turns !== 0 || event.is_error) {
                throw new Error("Claude Code rejected zero-turn history replay");
              }

              break;
            }
          }
        }
      }

      for (;;) {
        const event = await this.queue.next(input.signal, this.timeoutMs);

        if (!event) throw await this.exitError("Claude Code exited before completing its response");

        if (event.type === "assistant") {
          const error = nativeErrorText(event);

          if (error !== undefined) nativeError = error;
          else assistants.push(event.message);
        } else if (event.type === "result") {
          result = event;
          break;
        } else if (event.type === "rate_limit_event") {
          if (event.rate_limit_info && typeof event.rate_limit_info === "object")
            rateLimit = event.rate_limit_info;
        } else if (event.type === "stream_event" && !this.relay.used) {
          deliver(event.event);
        }
      }

      await this.relay.settled();
      input.signal?.throwIfAborted();

      let message: NativeMessage | undefined;

      if (this.relay.used) {
        if (
          this.relay.status !== 200 ||
          !this.relay.capture.complete ||
          !this.relay.capture.message
        ) {
          let detail = `status ${this.relay.status ?? "unknown"}, capture ${this.relay.capture.complete ? "complete" : "incomplete"}`;

          if (this.relay.failure) detail += `, relay failure ${this.relay.failure}`;

          if (this.relay.denied) detail += `, native retries denied ${this.relay.denied}`;
          const upstreamError = this.relay.errorText();

          if (upstreamError) detail += `, upstream said: ${upstreamError.slice(0, 500)}`;
          throw new Error(`Incomplete Claude Code upstream response (${detail})`);
        }

        message = this.relay.capture.message;
        sawMessageStop = true;
      } else {
        message = assistants.at(-1);
      }

      if (!message || !sawMessageStop || !result) {
        throw new Error(
          `Incomplete Claude Code response: assistant, message_stop and one result required${this.stderr ? ` (${this.stderr.trim().slice(-500)})` : ""}`,
        );
      }

      const nativeFailureHandled = this.relay.denied > 0 || message.stop_reason === "refusal";

      if (nativeError && !nativeFailureHandled)
        throw new Error(`Claude Code API error: ${nativeError}`);
      const hasTools = message.content.some((block) => block.type === "tool_use");
      const maxTurnsBoundary = hasTools && result.subtype === "error_max_turns";

      if (
        !maxTurnsBoundary &&
        !nativeFailureHandled &&
        (result.is_error || result.subtype !== "success")
      ) {
        throw new Error(`Claude Code request failed: ${result.subtype ?? "unknown result"}`);
      }

      for (const block of message.content) {
        if (block.type !== "tool_use") continue;

        if (
          !block.name.startsWith(TOOL_PREFIX) ||
          !input.toolNames.has(block.name.slice(TOOL_PREFIX.length))
        ) {
          throw new Error("Claude Code returned a tool outside Nyte's current tool inventory");
        }
      }

      const usage = message.usage ?? result.usage;

      if (
        !usage ||
        typeof usage.input_tokens !== "number" ||
        typeof usage.output_tokens !== "number"
      ) {
        throw new Error("Claude Code response did not include complete token usage");
      }

      if (
        rateLimit?.isUsingOverage === true &&
        !usageCreditsAllowed({ ...process.env, ...input.env })
      ) {
        throw usageCreditsChargeError(rateLimit);
      }

      return {
        message,
        usage,
        relay: {
          upstreamRequests: Number(this.relay.used),
          blockedRequests: this.relay.denied,
          requestId: this.relay.requestId,
        },
        initialUserPrefix:
          input.initialUserPrefix ??
          deriveInitialUserPrefix(this.relay.originalRequestBody, canonicalInitialUser),
        initialSystemMessages:
          input.initialSystemMessages ??
          deriveInitialSystemMessages(this.relay.originalRequestBody),
        rateLimit,
      };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.relay.finishTurn();
    }
  }

  async close(): Promise<void> {
    this.closeNow();
    await Promise.allSettled([this.readTask, this.exitOutcome, this.relay.close()]);
    await rm(this.root, { recursive: true, force: true });
  }

  private closeNow(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearExpiryTimer();
    this.relay.abort();

    if (this.child.exitCode === null) killProcessTree(this.child);
  }

  private async exitError(fallback: string): Promise<Error> {
    const outcome = await this.exitOutcome;

    if (outcome.error) return outcome.error;
    const detail = this.stderr.trim().slice(-500);

    return new Error(
      `${fallback} (exit ${outcome.code ?? "unknown"}${detail ? `: ${detail}` : ""})`,
    );
  }
}

interface AcquiredProcess {
  worker: ClaudeProcess;
  retained: boolean;
  continuation: boolean;
  sessionId?: string;
}

const processCache = new Map<string, ClaudeProcess>();

let managerTail: Promise<void> = Promise.resolve();

async function withManagerLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = managerTail;
  const pending = Promise.withResolvers<void>();
  managerTail = pending.promise;
  await previous;

  try {
    return await operation();
  } finally {
    pending.resolve();
  }
}

async function expireProcess(sessionId: string, worker: ClaudeProcess): Promise<void> {
  const expired = await withManagerLock(() => {
    if (processCache.get(sessionId) !== worker || worker.busy || !worker.isExpired()) return false;
    processCache.delete(sessionId);

    return true;
  });

  if (expired) await worker.close();
}

async function discardProcess(acquired: AcquiredProcess): Promise<void> {
  const { sessionId, worker } = acquired;

  if (sessionId && processCache.get(sessionId) === worker) {
    await withManagerLock(() => {
      if (processCache.get(sessionId) === worker) processCache.delete(sessionId);
    });
  }

  await worker.close();
}

async function acquireProcess(
  input: RunClaudeInput,
  plan: ClaudeLaunchPlan,
): Promise<AcquiredProcess> {
  return withManagerLock(async () => {
    const sessionId = input.sessionId;
    const cached = sessionId ? processCache.get(sessionId) : undefined;

    if (sessionId && cached && !cached.busy) {
      cached.clearExpiryTimer();

      if (
        cached.isAlive() &&
        !cached.isExpired() &&
        cached.fingerprint === plan.fingerprint &&
        cached.canContinue(input)
      ) {
        cached.busy = true;

        return { worker: cached, retained: true, continuation: true, sessionId };
      }

      processCache.delete(sessionId);
      await cached.close();
    }

    const retain = !!sessionId && !cached?.busy;

    if (retain) {
      while (processCache.size >= MAX_CACHED_CLAUDE_PROCESSES) {
        const victim = [...processCache.entries()]
          .filter(([, worker]) => !worker.busy)
          .toSorted((left, right) => left[1].lastUsed - right[1].lastUsed)[0];

        if (!victim) break;
        processCache.delete(victim[0]);
        await victim[1].close();
      }
    }

    const worker = await ClaudeProcess.create(input, plan);
    worker.busy = true;
    const retained = retain && processCache.size < MAX_CACHED_CLAUDE_PROCESSES;

    if (retained && sessionId) processCache.set(sessionId, worker);

    return { worker, retained, continuation: false, sessionId };
  });
}

async function closeClaudeProcesses(sessionId?: string): Promise<void> {
  const workers = await withManagerLock(() => {
    if (sessionId) {
      const worker = processCache.get(sessionId);
      processCache.delete(sessionId);

      return worker ? [worker] : [];
    }

    const all = [...processCache.values()];
    processCache.clear();

    return all;
  });

  await Promise.allSettled(workers.map((worker) => worker.close()));
}

registerSessionResourceCleanup((sessionId) => {
  void closeClaudeProcesses(sessionId);
});

export async function runClaudeRequest(input: RunClaudeInput): Promise<RunClaudeOutput> {
  input.signal?.throwIfAborted();
  const plan = launchPlan(input);
  const acquired = await acquireProcess(input, plan);

  try {
    const output = await acquired.worker.run(input, acquired.continuation);
    const stable = acquired.worker.commit(input, output.message);

    if (
      stable &&
      acquired.retained &&
      acquired.sessionId &&
      processCache.get(acquired.sessionId) === acquired.worker
    ) {
      acquired.worker.busy = false;
      const sessionId = acquired.sessionId;
      acquired.worker.armExpiryTimer(() => {
        void expireProcess(sessionId, acquired.worker);
      });
    } else {
      await discardProcess(acquired);
    }

    return output;
  } catch (error) {
    await discardProcess(acquired);
    throw error;
  }
}
