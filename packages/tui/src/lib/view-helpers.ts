import type { Message } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";
import { showsAnswer, showsReport } from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";

export function unlandedMessages(messages: readonly Message[]): readonly UserMessage[] {
  return messages.flatMap((message) =>
    message.kind === "user" && message.status.kind !== "landed" ? [message] : [],
  );
}

export function promptMessages(view: HeadView): readonly UserMessage[] {
  return unlandedMessages(view.messages).filter(
    (message) => !showsReport(message) && !showsAnswer(message),
  );
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
