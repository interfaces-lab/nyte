import type { Message, SessionView, Usage } from "@nyte-ai/sdk";
import { showsReport } from "@nyte-ai/plugin/client/presentation";
import type { ReportMessage, UserMessage } from "@nyte-ai/plugin/client/presentation";

const UNLANDED = new WeakMap<readonly Message[], readonly UserMessage[]>();

function unlandedMessages(messages: readonly Message[]): readonly UserMessage[] {
  const known = UNLANDED.get(messages);

  if (known !== undefined) return known;

  const unlanded = messages.flatMap((message) =>
    message.kind === "user" && message.status.kind !== "landed" ? [message] : [],
  );

  UNLANDED.set(messages, unlanded);

  return unlanded;
}

function landsNow(message: UserMessage, view: SessionView): boolean {
  return (
    view.execution.kind === "idle" &&
    (message.status.kind === "pending" ||
      (message.status.kind === "unsent" && message.status.retrying === null))
  );
}

export function queuedMessages(view: SessionView): readonly UserMessage[] {
  return unlandedMessages(view.messages).filter(
    (message) => !showsReport(message) && !landsNow(message, view),
  );
}

export function landingMessages(view: SessionView): readonly UserMessage[] {
  return unlandedMessages(view.messages).filter(
    (message) => !showsReport(message) && landsNow(message, view),
  );
}

export function pendingReports(view: SessionView): readonly ReportMessage[] {
  return unlandedMessages(view.messages).filter(showsReport);
}

export function sessionUsage(view: SessionView): Usage {
  const empty: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return view.turns.reduce((sum, turn) => {
    if (turn.state.kind !== "ended" || turn.state.end.kind !== "completed") return sum;
    const usage = turn.state.end.usage;

    return {
      input: sum.input + usage.input,
      output: sum.output + usage.output,
      cacheRead: sum.cacheRead + usage.cacheRead,
      cacheWrite: sum.cacheWrite + usage.cacheWrite,
      reasoning: usage.reasoning === null ? sum.reasoning : (sum.reasoning ?? 0) + usage.reasoning,
      total: sum.total + usage.total,
      cost: {
        input: sum.cost.input + usage.cost.input,
        output: sum.cost.output + usage.cost.output,
        cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
        cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
        total: sum.cost.total + usage.cost.total,
      },
    };
  }, empty);
}

export function follow<T>(
  stream: AsyncIterable<T>,
  next: (value: T) => void,
  fail: (cause: unknown) => void,
): () => void {
  const iterator = stream[Symbol.asyncIterator]();
  let open = true;

  void (async () => {
    try {
      for (;;) {
        const step = await iterator.next();

        if (step.done === true || !open) return;
        next(step.value);
      }
    } catch (cause) {
      if (open) fail(cause);
    }
  })();

  return () => {
    if (!open) return;
    open = false;
    void iterator.return?.();
  };
}
