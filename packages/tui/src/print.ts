import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { RunEnd, SendReceipt, Session, SessionId } from "@nyte-ai/sdk";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import { sessionRecovery } from "./flags.ts";
import { exitStatus } from "./lifecycle.ts";
import type { Ending } from "./lifecycle.ts";

export interface PrintOutput {
  write(text: string): void;
  error(text: string): void;
}

interface PrintOptions {
  readonly session: Session;
  /** The prompt's receipt: its start or send already admitted it. */
  readonly receipt: SendReceipt;
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
  | { readonly kind: "cancelled"; readonly signal?: Ending }
  | { readonly kind: "input-required" };

function toPrintOutcome(end: RunEnd): PrintOutcome {
  switch (end.kind) {
    case "completed":
      return { kind: "completed" };
    case "stopped":
      return { kind: "aborted" };
    case "failed":
      return { kind: "failed", message: end.failure.message };
    default: {
      const _exhaustive: never = end;

      return _exhaustive;
    }
  }
}

export async function printRun(options: PrintOptions): Promise<PrintOutcome> {
  const { session, receipt, output } = options;

  if (options.signal?.aborted === true) {
    await receipt.stop();

    return { kind: "cancelled" };
  }

  const written = new Map<string, string>();
  const tools = new Set<string>();
  let lineOpen = false;

  const writeText = (chunk: string): void => {
    if (chunk === "") return;

    if (options.json) output.write(`${JSON.stringify({ type: "text", text: chunk })}\n`);
    else {
      output.write(chunk);
      lineOpen = !chunk.endsWith("\n");
    }
  };

  const cancelled = new Promise<"cancelled">((resolve) => {
    options.signal?.addEventListener("abort", () => resolve("cancelled"), { once: true });
  });

  const views = session.watch()[Symbol.asyncIterator]();
  // oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- read through a call: inline, the early return keeps `signal.aborted` narrowed to false across the awaits
  const aborted = (): boolean => options.signal?.aborted === true;

  try {
    for (;;) {
      const next = await Promise.race([views.next(), cancelled]);

      if (next === "cancelled") {
        await receipt.stop();

        return { kind: "cancelled" };
      }

      if (next.done === true) throw new Error("Output watch ended before the run did.");
      const view = next.value;
      const turn = view.turns.find((candidate) => candidate.prompt === receipt.message);

      if (turn === undefined) continue;

      for (const message of view.messages) {
        if (message.turn !== turn.id || message.kind !== "part") continue;

        if (showsText(message)) {
          const before = written.get(message.id) ?? "";

          if (message.status.kind === "failed" && before !== "")
            throw new Error(
              "The provider retried after text was delivered. Open the session to inspect the answer.",
            );

          if (!message.state.markdown.startsWith(before))
            throw new Error(
              "The answer changed after it was delivered. Open the session to inspect it.",
            );
          writeText(message.state.markdown.slice(before.length));
          written.set(message.id, message.state.markdown);
        } else if (showsTool(message) && !tools.has(message.id)) {
          tools.add(message.id);

          if (options.quiet) continue;

          if (options.json)
            output.write(`${JSON.stringify({ type: "tool", name: message.state.name })}\n`);
          else output.error(message.state.name);
        }
      }

      if (turn.state.kind === "waiting" && openQuestions(view).length > 0) {
        await receipt.stop();
        await receipt.settled();

        return { kind: "input-required" };
      }

      if (turn.state.kind === "ended") return toPrintOutcome(turn.state.end);
    }
  } catch (cause) {
    if (aborted()) {
      await receipt.stop();

      return { kind: "cancelled" };
    }

    return {
      kind: "failed",
      code: "delivery_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    await views.return?.();

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
      return exitStatus(outcome.signal ?? "SIGINT");
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}
