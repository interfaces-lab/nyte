/**
 * Non-interactive mode: send one prompt, stream the answer to stdout, and
 * exit with the run's outcome. The same SDK verbs the shell uses, over an
 * output the caller supplies, so a test drives it with a scripted provider.
 */
import type { Nyte, RunInfo, SessionId } from "@nyte-ai/core";
import { isRunning } from "./session-state.ts";

export type PrintJsonEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly name: string }
  | { readonly type: "result"; readonly session: string; readonly kind: string }
  | { readonly type: "error"; readonly message: string };

export interface PrintOutput {
  write(text: string): void;
  error(text: string): void;
}

export interface PrintOptions {
  readonly nyte: Pick<Nyte, "messages" | "runs" | "sessions" | "watch">;
  readonly sessionId: SessionId;
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
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "cancelled" };

function encode(event: PrintJsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** The run's durable outcome, read back from the run ref once it is terminal. */
function outcomeOf(run: RunInfo | undefined): PrintOutcome {
  if (run === undefined) return { kind: "failed", message: "run did not start" };
  switch (run.phase.kind) {
    case "done":
      return { kind: "completed" };
    case "aborted":
      return { kind: "aborted" };
    case "failed":
      return { kind: "failed", message: run.phase.error };
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

function waitInput(
  sessionId: SessionId,
  signal: AbortSignal | undefined,
): { readonly sessionId: SessionId; readonly signal?: AbortSignal } {
  return signal === undefined ? { sessionId } : { sessionId, signal };
}

/** Wait through background tools; report only a call that needs stdin. */
async function waitForRun(
  nyte: PrintOptions["nyte"],
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<"idle" | "question" | "cancelled"> {
  for (;;) {
    if (signal.aborted) return "cancelled";
    const waiting = await nyte.runs.wait(waitInput(sessionId, signal));
    if (signal.aborted) return "cancelled";
    if (waiting.kind === "idle") return "idle";

    const snapshot = await nyte.sessions.snapshot({ sessionId });
    if (snapshot === undefined || !isRunning(snapshot.run)) return "idle";
    if (snapshot.parked?.some((call) => call.tool === "question") === true) return "question";
    const afterSeq = snapshot?.seq ?? 0;
    for await (const event of nyte.watch({ sessionId, afterSeq, signal })) {
      const effectChanged = event.kind === "effect" && event.runId === waiting.runId;
      const runChanged = event.kind === "run" && event.run.runId === waiting.runId;
      if (effectChanged || runChanged) break;
    }
  }
}

export async function printRun(options: PrintOptions): Promise<PrintOutcome> {
  const { nyte, sessionId, output } = options;
  const stop = new AbortController();
  const signal =
    options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  let lineOpen = false;
  const endLine = (): void => {
    if (!lineOpen) return;
    lineOpen = false;
    output.write("\n");
  };
  const streaming = (async (): Promise<void> => {
    for await (const event of nyte.watch({ sessionId, live: true, signal })) {
      if (event.kind === "text_delta") {
        if (options.json) output.write(encode({ type: "text", text: event.delta }));
        else {
          output.write(event.delta);
          lineOpen = true;
        }
        continue;
      }
      if (event.kind !== "commit" || options.quiet) continue;
      const { body } = event.item.commit;
      if (body.kind !== "message" || body.message.role !== "assistant") continue;
      for (const part of body.message.content) {
        if (part.type !== "toolCall") continue;
        if (options.json) output.write(encode({ type: "tool", name: part.name }));
        else {
          endLine();
          output.write(`${part.name}\n`);
        }
      }
    }
  })().catch(() => undefined);

  try {
    if (options.signal?.aborted === true) return { kind: "cancelled" };
    await nyte.messages.send({ sessionId, content: options.content, key: crypto.randomUUID() });
    const waited = await waitForRun(nyte, sessionId, signal);
    if (waited === "cancelled") return { kind: "cancelled" };
    if (waited === "question") {
      await nyte.runs.abort({ sessionId });
      await nyte.runs.wait({ sessionId });
    }
    const run = await nyte.runs.current({ sessionId });
    return isRunning(run) ? { kind: "failed", message: "run did not complete" } : outcomeOf(run);
  } finally {
    stop.abort();
    await streaming;
    endLine();
  }
}

/** Say how the run ended, on stderr for a human and as the last JSON line otherwise. */
export function reportPrintOutcome(
  outcome: PrintOutcome,
  options: { readonly sessionId: SessionId; readonly json: boolean; readonly output: PrintOutput },
): number {
  const { output } = options;
  switch (outcome.kind) {
    case "completed":
    case "aborted":
      if (options.json) {
        output.write(encode({ type: "result", session: options.sessionId, kind: outcome.kind }));
      } else {
        output.error(`session ${options.sessionId} · ${outcome.kind}`);
        output.error(`resume with: nyte -p --resume ${options.sessionId}`);
      }
      return outcome.kind === "completed" ? 0 : 130;
    case "failed":
      if (options.json) output.write(encode({ type: "error", message: outcome.message }));
      else output.error(`error: ${outcome.message}`);
      return 1;
    case "cancelled":
      return 130;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
