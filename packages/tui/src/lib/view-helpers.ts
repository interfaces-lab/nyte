import type { Message, SessionView } from "@nyte-ai/sdk";
import { showsReport, waitsInQueue } from "@nyte-ai/plugin/client/presentation";
import type {
  QueuedMessage,
  ReportMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";

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

export function queuedMessages(view: SessionView): readonly QueuedMessage[] {
  const running = view.execution.kind !== "idle";

  return unlandedMessages(view.messages).filter((message): message is QueuedMessage =>
    waitsInQueue(message, running),
  );
}

export function promptMessages(view: SessionView): readonly UserMessage[] {
  const running = view.execution.kind !== "idle";

  return unlandedMessages(view.messages).filter(
    (message) => !showsReport(message) && !waitsInQueue(message, running),
  );
}

export function pendingReports(view: SessionView): readonly ReportMessage[] {
  return unlandedMessages(view.messages).filter(showsReport);
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
