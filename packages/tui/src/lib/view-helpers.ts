import type { Message } from "@nyte-ai/sdk";
import type { HeadView } from "@nyte-ai/sdk/client";
import { showsAnswer, showsReport } from "@nyte-ai/plugin/client/presentation";
import type {
  AnswerMessage,
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

export function promptMessages(view: HeadView): readonly UserMessage[] {
  return unlandedMessages(view.messages).filter(
    (message) => !showsReport(message) && !showsAnswer(message),
  );
}

export function pendingReports(view: HeadView): readonly ReportMessage[] {
  return unlandedMessages(view.messages).filter(showsReport);
}

export function pendingAnswers(view: HeadView): readonly AnswerMessage[] {
  return unlandedMessages(view.messages).filter(showsAnswer);
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
