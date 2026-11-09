import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import type { Provider } from "@nyte-ai/ai/models";
import { getCurrentTools } from "@nyte-ai/schema/model";
import type { TranscriptContext } from "@nyte-ai/schema/model";

interface Spent {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
}

/**
 * Adds up every model request's usage, including requests of runs a deadline stopped, and keeps
 * the first request that offered tools apart: that one is the harness's fixed prompt plus the
 * user's message, before any work. A chat-title request offers no tools, so it never counts as first.
 */
export function meterUsage() {
  const usages: Promise<Spent | null>[] = [];

  let first: Promise<{ readonly tokens: number; readonly tools: number } | null> =
    Promise.resolve(null);

  let seenFirst = false;

  const record = (
    context: TranscriptContext,
    stream: AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const spent = stream.result().then(
      (message) => ({
        input: message.usage.input,
        output: message.usage.output,
        cacheRead: message.usage.cacheRead,
        cacheWrite: message.usage.cacheWrite,
        cost: message.usage.cost.total,
      }),
      () => null,
    );

    usages.push(spent);
    const tools = getCurrentTools(context.messages).length;

    if (!seenFirst && tools > 0) {
      seenFirst = true;
      first = spent.then((usage) =>
        usage === null ? null : { tokens: usage.input + usage.cacheRead + usage.cacheWrite, tools },
      );
    }

    return stream;
  };

  const wrap = (inner: Provider): Provider => ({
    ...inner,
    stream: (model, context, options) => record(context, inner.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      record(context, inner.streamSimple(model, context, options)),
  });

  const total = async () => {
    const all = (await Promise.all(usages)).filter((usage) => usage !== null);

    const sum = (pick: (usage: Spent) => number) =>
      all.reduce((acc, usage) => acc + pick(usage), 0);

    return {
      requests: all.length,
      input: sum((usage) => usage.input + usage.cacheRead + usage.cacheWrite),
      output: sum((usage) => usage.output),
      cacheRead: sum((usage) => usage.cacheRead),
      cost: sum((usage) => usage.cost),
      first: await first,
    };
  };

  return { wrap, total };
}
