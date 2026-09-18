import { isTerminalPhase } from "@nyte-ai/protocol";
/**
 * Non-interactive mode: send one prompt, stream the answer to stdout, and
 * exit with the run's outcome. The same SDK operations the shell uses, over an
 * output the caller supplies, so a test drives it with a scripted provider.
 */
import type { Nyte, RunInfo, SessionEvent, SessionId } from "@nyte-ai/core";
import { EMPTY_LIVE_PARTS, foldLiveParts } from "@nyte-ai/client";
import { sessionRecovery } from "./flags.ts";

export interface PrintOutput {
  write(text: string): void;
  error(text: string): void;
}

interface PrintOptions {
  readonly nyte: Pick<Nyte, "messages" | "runs" | "sessions" | "watch">;
  readonly sessionId: SessionId;
  readonly configure?: Pick<
    Parameters<Nyte["sessions"]["configure"]>[0],
    "model" | "thinkingLevel"
  >;
  readonly content: string;
  readonly json: boolean;
  /** Skip tool lines; the answer alone is what a pipe wants. */
  readonly quiet: boolean;
  readonly output: PrintOutput;
  readonly signal?: AbortSignal;
}

export type PrintOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly message: string; readonly code?: string }
  | { readonly kind: "cancelled"; readonly signal?: "SIGINT" | "SIGTERM" }
  | { readonly kind: "input-required" };

/** The run's durable outcome, read back from the run ref once it is terminal. */
function outcomeOf(run: RunInfo | undefined): PrintOutcome {
  if (run === undefined) return { kind: "failed", message: "run did not start" };
  switch (run.phase.kind) {
    case "done":
      return { kind: "completed" };
    case "aborted":
      return { kind: "aborted" };
    case "failed":
      return { kind: "failed", message: run.phase.failure.message };
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return { kind: "failed", message: "run did not complete" };
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

/** Wait through background tools; report only a call that needs stdin. */
async function waitForRun(
  nyte: PrintOptions["nyte"],
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<"idle" | "question" | "cancelled"> {
  for (;;) {
    if (signal.aborted) return "cancelled";
    const waiting = await nyte.runs.wait({ sessionId, signal });
    if (signal.aborted) return "cancelled";
    if (waiting.kind === "cancelled") return "cancelled";
    if (waiting.kind === "idle") return "idle";

    const snapshot = await nyte.sessions.snapshot({ sessionId });
    if (snapshot?.run === undefined || isTerminalPhase(snapshot.run.phase)) return "idle";
    if (snapshot.parked?.some((call) => call.selection !== undefined) === true) return "question";
    let changed = false;
    for await (const event of nyte.watch({ sessionId, afterSeq: snapshot.seq, signal })) {
      const effectChanged = event.kind === "effect" && event.runId === waiting.runId;
      const runChanged = event.kind === "run" && event.run.runId === waiting.runId;
      if (effectChanged || runChanged) {
        changed = true;
        break;
      }
    }
    if (!changed && !signal.aborted)
      throw new Error("Output watch ended while a tool was waiting.");
  }
}

export async function printRun(options: PrintOptions): Promise<PrintOutcome> {
  const { nyte, sessionId, output } = options;
  if (options.signal?.aborted === true) return { kind: "cancelled" };
  if (options.configure !== undefined) {
    const configured = await nyte.sessions.configure({ sessionId, ...options.configure });
    if (configured.kind !== "queued") {
      return { kind: "failed", code: "configuration_failed", message: configured.kind };
    }
  }
  if (options.signal?.aborted) return { kind: "cancelled" };
  const before = await nyte.sessions.snapshot({ sessionId });
  if (before === undefined) throw new Error(`Session not found: ${sessionId}`);
  const stop = new AbortController();
  const signal =
    options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  let parts = EMPTY_LIVE_PARTS;
  const delivered = new Set<string>();
  const runs = new Set(before.run === undefined ? [] : [before.run.runId]);
  let lineOpen = false;
  const writeText = (text: string): void => {
    if (text === "") return;
    if (options.json) output.write(`${JSON.stringify({ type: "text", text })}\n`);
    else {
      output.write(text);
      lineOpen = !text.endsWith("\n");
    }
  };
  const deliver = (event: SessionEvent): void => {
    if (event.kind === "run") {
      if (event.head !== before.head) return;
      runs.add(event.run.runId);
      if (
        event.run.phase.kind === "retry" &&
        parts.some((part) => part.kind === "text" && part.runId === event.run.runId)
      ) {
        throw new Error(
          "The provider retried after text was delivered. Open the session to inspect the answer.",
        );
      }
    }
    if (event.kind === "text_delta") {
      if (!runs.has(event.runId)) return;
      writeText(event.delta);
    }
    if (event.kind === "commit" && event.head === before.head) {
      const { oid, commit } = event.item;
      if (delivered.has(oid)) return;
      delivered.add(oid);
      const body = commit.body;
      if (body.kind === "message" && body.message.role === "assistant") {
        const text = body.message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("");
        const prefix = parts
          .flatMap((part) => (part.kind === "text" && part.runId === commit.run ? [part.text] : []))
          .join("");
        if (!text.startsWith(prefix)) {
          throw new Error(
            "Committed answer differs from delivered text. Open the session to inspect it.",
          );
        }
        writeText(text.slice(prefix.length));
        for (const part of body.message.content) {
          if (part.type !== "toolCall" || options.quiet) continue;
          if (options.json) output.write(`${JSON.stringify({ type: "tool", name: part.name })}\n`);
          else output.error(part.name);
        }
      }
    }
    parts = foldLiveParts(parts, event);
  };
  let deliveryFailure: { readonly cause: unknown } | undefined;
  const streaming = (async (): Promise<void> => {
    try {
      for await (const event of nyte.watch({ sessionId, afterSeq: before.seq, signal })) {
        deliver(event);
      }
      if (!signal.aborted) throw new Error("Output watch ended before delivery completed.");
    } catch (cause) {
      if (signal.aborted && cause instanceof Error && cause.name === "AbortError") return;
      deliveryFailure = { cause };
      stop.abort();
    }
  })();
  try {
    signal.throwIfAborted();
    await nyte.messages.send({ sessionId, content: options.content, key: crypto.randomUUID() });
    const waited = await waitForRun(nyte, sessionId, signal);
    if (options.signal?.aborted) {
      await nyte.runs.abort({ sessionId });
      return { kind: "cancelled" };
    }
    if (waited === "question") {
      await nyte.runs.abort({ sessionId });
      // Print deliberately aborts questions and consent. Caller cancellation is
      // not durable settlement, so this wait must not use the output signal.
      const settled = await nyte.runs.wait({ sessionId });
      const run = await nyte.runs.current({ sessionId });
      if (settled.kind !== "idle" || run?.phase.kind !== "aborted") {
        return {
          kind: "failed",
          code: "input_abort_failed",
          message:
            "The input-required run did not settle as aborted. Open the session to inspect it.",
        };
      }
    }
    stop.abort();
    await streaming;
    if (deliveryFailure !== undefined) throw deliveryFailure.cause;
    if (waited === "cancelled") return { kind: "cancelled" };

    // The first watch preserves live output. Replay only durable commits to the
    // SDK's synced barrier to drain writes the waiter saw before our watcher did.
    // Oids identify commits; seq alone would drop siblings in one head move.
    let synced = false;
    for await (const event of nyte.watch({
      sessionId,
      afterSeq: before.seq,
      signal: options.signal,
    })) {
      if (event.kind === "synced") {
        synced = true;
        break;
      }
      if (event.kind === "commit") deliver(event);
    }
    if (options.signal?.aborted) return { kind: "cancelled" };
    if (!synced) throw new Error("Output replay ended before delivery completed.");
    return waited === "question"
      ? { kind: "input-required" }
      : outcomeOf(await nyte.runs.current({ sessionId }));
  } catch (cause) {
    if (options.signal?.aborted) {
      await nyte.runs.abort({ sessionId });
      return { kind: "cancelled" };
    }
    const error = deliveryFailure === undefined ? cause : deliveryFailure.cause;
    return {
      kind: "failed",
      code: "delivery_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    stop.abort();
    await streaming;
    if (lineOpen) output.write("\n");
  }
}

/** Called once by the invocation owner, after all resource cleanup. */
export function reportPrintOutcome(
  outcome: PrintOutcome,
  options: { readonly sessionId?: SessionId; readonly json: boolean; readonly output: PrintOutput },
): number {
  const next = options.sessionId === undefined ? undefined : sessionRecovery(options.sessionId);
  const code =
    outcome.kind === "failed"
      ? (outcome.code ?? "run_failed")
      : outcome.kind === "cancelled"
        ? "local_cancelled"
        : outcome.kind === "input-required"
          ? "input_required"
          : outcome.kind;
  if (options.json) {
    options.output.write(
      `${JSON.stringify({
        type: "result",
        kind: outcome.kind,
        code,
        session: options.sessionId,
        message: outcome.kind === "failed" ? outcome.message : undefined,
        signal: outcome.kind === "cancelled" ? outcome.signal : undefined,
        next,
      })}\n`,
    );
  } else {
    options.output.error(
      outcome.kind === "failed"
        ? `error: ${outcome.message}`
        : `${options.sessionId === undefined ? "" : `session ${options.sessionId} · `}${outcome.kind}`,
    );
    if (next !== undefined) options.output.error(`open in a terminal: ${next.command}`);
  }
  switch (outcome.kind) {
    case "completed":
      return 0;
    case "failed":
      return 1;
    case "input-required":
      return 2;
    case "aborted":
      return 130;
    case "cancelled":
      return outcome.signal === "SIGTERM" ? 143 : 130;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
