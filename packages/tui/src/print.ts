import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { OpenQuestion } from "@nyte-ai/plugin/question/schema";
import type { Failure, RunEnd, SendReceipt, Session, SessionId } from "@nyte-ai/sdk";
import type { HostConnection } from "@nyte-ai/sdk/client";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import { CliError } from "./cli/errors.ts";
import type { NextStep } from "./cli/errors.ts";
import { formatCommand, formatNextJson, printable } from "./cli/format.ts";
import type { Output } from "./cli/output.ts";
import { sessionRecovery } from "./flags.ts";
import { chatViews, openChat } from "./live-host.ts";

interface PrintOptions {
  readonly session: Session;
  readonly live: HostConnection;
  /** The prompt's receipt: its start or send already admitted it. */
  readonly receipt: SendReceipt;
  readonly json: boolean;
  /** Skip tool lines; the answer alone is what a pipe wants. */
  readonly quiet: boolean;
  readonly output: Output;
  readonly signal: AbortSignal;
}

/** `--json` stdout, one record per line. Only a completed run ends with a `result`; any other ending writes one error document on stderr instead. */
type PrintRecord =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly name: string }
  | {
      readonly type: "result";
      readonly outcome: "completed";
      readonly session: SessionId;
      readonly next: ReturnType<typeof formatNextJson>;
    };

type StopOutcome = Awaited<ReturnType<SendReceipt["stop"]>>;

/** How long a cancel waits for the host to confirm the run stopped. The invocation's shutdown deadline bounds the rest. */
const STOP_CONFIRM_MS = 500;

/** How following a run ended. */
type RunEnding =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly failure: Failure }
  /** Another client stopped it. */
  | { readonly kind: "stopped" }
  /** A signal stopped waiting, and this process asked the host to stop the run. */
  | { readonly kind: "canceled"; readonly stop: StopOutcome }
  | { readonly kind: "asked"; readonly questions: OpenQuestion["questions"] }
  /** This process lost track of the run, which may still be running. */
  | { readonly kind: "lost"; readonly cause: string };

/** The headline's cause for each failure class. The provider's own message goes in a detail row, never here. */
const FAILURE_CAUSES: Readonly<Record<Failure["class"], string>> = {
  rate_limit: "The provider limited the request rate.",
  auth: "The provider didn't accept the credential.",
  quota: "The provider account is out of quota.",
  context_window: "The chat no longer fits the model's context window.",
  overloaded: "The provider is overloaded.",
  network: "The provider couldn't be reached.",
  aborted: "The provider ended the request.",
  provider: "The provider returned an error.",
  runner: "Nyte's runner failed.",
};

/**
 * Streams the run's answer to stdout and tool names to stderr until the run ends. A completed run
 * writes its result: the `result` record with `--json`, else a receipt on stderr. Every other
 * ending throws a `CliError` that carries the session.
 */
export async function printRun(options: PrintOptions): Promise<void> {
  const ending = await follow(options);
  const id = options.session.id;
  const output = options.output;
  const open: NextStep = { label: "Open the chat", argv: sessionRecovery(id).argv };

  if (ending.kind !== "completed") throw runError(ending, id, open);

  if (options.json) {
    record(output, {
      type: "result",
      outcome: "completed",
      session: id,
      next: formatNextJson([
        {
          label: "Send a follow-up in place of <PROMPT>",
          argv: ["nyte", "-p", `--session=${id}`, "<PROMPT>"],
        },
        { label: "Open the chat in a terminal", argv: open.argv },
      ]),
    });

    return;
  }

  if (output.mode.tty.stdout) output.say("");
  output.rows([
    { gutter: "done", label: "Completed", value: "" },
    { label: "Session", value: id },
  ]);
  output.say("");
  output.say(`  ${open.label}:`);
  output.say(formatCommand(open.argv, output.mode.stderr));
}

async function follow(options: PrintOptions): Promise<RunEnding> {
  const receipt = options.receipt;
  const output = options.output;

  if (options.signal.aborted) return { kind: "canceled", stop: await stopRun(receipt) };

  const written = new Map<string, string>();
  const tools = new Set<string>();
  let lineOpen = false;

  const writeText = (chunk: string): void => {
    if (chunk === "") return;

    if (options.json) {
      record(output, { type: "text", text: chunk });

      return;
    }

    output.result(output.mode.tty.stdout ? shownOnTerminal(chunk) : chunk);
    lineOpen = !chunk.endsWith("\n");
  };

  const canceled = new Promise<"canceled">((resolve) => {
    options.signal.addEventListener("abort", () => resolve("canceled"), { once: true });
  });

  const views = chatViews(options.live, openChat(options.live, options.session.id), null)[
    Symbol.asyncIterator
  ]();

  // oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- read through a call: inline, the early return keeps `signal.aborted` narrowed to false across the awaits
  const aborted = (): boolean => options.signal.aborted;

  try {
    for (;;) {
      const next = await Promise.race([views.next(), canceled]);

      if (next === "canceled") return { kind: "canceled", stop: await stopRun(receipt) };

      if (next.done === true)
        return { kind: "lost", cause: "The chat's updates ended before the run did." };
      const view = next.value;
      const turn = view.turns.find((candidate) => candidate.prompt === receipt.message);

      if (turn === undefined) continue;

      for (const message of view.messages) {
        if (message.turn !== turn.id || message.kind !== "part") continue;

        if (showsText(message)) {
          const before = written.get(message.id) ?? "";

          if (
            message.status.kind === "failed" &&
            message.status.failure.class !== "aborted" &&
            before !== ""
          )
            return {
              kind: "lost",
              cause: "The provider retried after part of the answer was printed.",
            };

          if (!message.state.markdown.startsWith(before))
            return { kind: "lost", cause: "The answer changed after part of it was printed." };
          writeText(message.state.markdown.slice(before.length));
          written.set(message.id, message.state.markdown);
        } else if (showsTool(message) && !tools.has(message.id)) {
          tools.add(message.id);

          if (options.quiet) continue;

          if (options.json) record(output, { type: "tool", name: message.state.name });
          else output.say(`  Running ${printable(message.state.name)}…`);
        }
      }

      const on = turn.state.kind === "waiting" ? turn.state.on : null;

      const asked =
        on?.kind === "part"
          ? openQuestions(view).find((request) => request.part === on.part)
          : undefined;

      if (asked !== undefined) {
        await receipt.stop();
        await receipt.settled();

        return { kind: "asked", questions: asked.questions };
      }

      if (turn.state.kind === "ended") return runEnding(turn.state.end);
    }
  } catch (cause) {
    if (aborted()) return { kind: "canceled", stop: await stopRun(receipt) };

    return { kind: "lost", cause: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    await views.return?.();

    if (lineOpen) output.result("\n");
  }
}

function runEnding(end: RunEnd): RunEnding {
  switch (end.kind) {
    case "completed":
      return { kind: "completed" };
    case "stopped":
      return { kind: "stopped" };
    case "failed":
      return { kind: "failed", failure: end.failure };
    default: {
      const _exhaustive: never = end;

      return _exhaustive;
    }
  }
}

function runError(
  ending: Exclude<RunEnding, { readonly kind: "completed" }>,
  session: SessionId,
  open: NextStep,
): CliError {
  const row = { label: "Session", value: session };

  switch (ending.kind) {
    case "failed": {
      const message = printable(ending.failure.message);

      return new CliError(
        "run_failed",
        `Couldn't finish the run. ${FAILURE_CAUSES[ending.failure.class]}`,
        {
          details: [
            row,
            { label: ending.failure.class === "runner" ? "Runner" : "Provider", value: message },
          ],
          data: { session, failure: ending.failure.class, remoteMessage: message },
          next:
            ending.failure.class === "auth"
              ? [{ label: "Sign in again", argv: ["nyte", "login"] }, open]
              : [open],
        },
      );
    }

    case "stopped":
      return new CliError("run_stopped", "Couldn't finish the run. Another client stopped it.", {
        details: [row],
        data: { session },
        next: [open],
      });
    case "canceled": {
      const stop = stopReport(ending.stop);

      return new CliError("canceled", stop.message, {
        details: [row, { label: "Run", value: stop.remote }],
        data: { session, remote: stop.remote },
        next: [open],
      });
    }

    case "asked":
      return new CliError("input_required", "Can't finish the run. The agent asked a question.", {
        details: [
          row,
          ...ending.questions.flatMap((question) => [
            { label: "Question", value: printable(question.question) },
            ...(question.options.length === 0
              ? []
              : [
                  {
                    label: "Choices",
                    value: question.options.map((option) => printable(option.label)).join(", "),
                  },
                ]),
          ]),
        ],
        data: {
          session,
          questions: ending.questions.map((question) => ({
            question: printable(question.question),
            choices: question.options.map((option) => printable(option.label)),
          })),
        },
        next: [
          { label: "Answer it", argv: ["nyte", "-p", `--session=${session}`, "<ANSWER>"] },
          open,
        ],
      });
    case "lost":
      return new CliError(
        "unknown_outcome",
        "Couldn't follow the run to its end. It may still be running.",
        {
          details: [row, { label: "Cause", value: ending.cause }],
          data: { session, cause: ending.cause },
          next: [open],
        },
      );
    default: {
      const _exhaustive: never = ending;

      return _exhaustive;
    }
  }
}

/** Asks the host to stop the run, then waits briefly so the report says whether it stopped. */
async function stopRun(receipt: SendReceipt): Promise<StopOutcome> {
  const stop = await receipt.stop();

  if (stop.kind !== "requested") return stop;

  return receipt.settled({ signal: AbortSignal.timeout(STOP_CONFIRM_MS) }).then(
    (outcome) => ({ kind: "settled", outcome }),
    () => stop,
  );
}

/** What the host said when this process stopped waiting: `remote` is the run's state, as `data.remote` says it. */
function stopReport(stop: StopOutcome) {
  if (stop.kind === "requested")
    return { remote: "stopping", message: "Stopped waiting. The host is stopping the run." };

  if (stop.kind === "missing")
    return { remote: "unknown", message: "Stopped waiting. Couldn't confirm the run stopped." };

  switch (stop.outcome.kind) {
    case "stopped":
      return { remote: "stopped", message: "Stopped waiting, and stopped the run." };
    case "completed":
      return { remote: "completed", message: "Stopped waiting. The run had already completed." };
    case "failed":
      return { remote: "failed", message: "Stopped waiting. The run had already failed." };
    default:
      return { remote: stop.outcome.kind, message: "Stopped waiting. The prompt didn't run." };
  }
}

/** Model text on a terminal: controls show as `\xNN` instead of acting, but its lines and tabs stay. */
function shownOnTerminal(text: string): string {
  return text
    .split("\n")
    .map((line) => line.split("\t").map(printable).join("\t"))
    .join("\n");
}

function record(output: Output, value: PrintRecord): void {
  output.result(`${JSON.stringify(value)}\n`);
}
