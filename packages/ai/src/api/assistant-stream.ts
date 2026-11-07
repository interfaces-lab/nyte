import type { Api, AssistantMessage, Model, Usage } from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

export function emptyCost(): Usage["cost"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: emptyCost() };
}

export function emptyAssistantOutput(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

export function stripStreamingScratchState(content: AssistantMessage["content"]): void {
  for (const block of content) {
    if ("partialJson" in block) delete block.partialJson;

    if ("partialArgs" in block) delete block.partialArgs;

    if ("customInput" in block) delete block.customInput;

    if ("streamIndex" in block) delete block.streamIndex;
  }
}

function formatStreamError(error: unknown): string {
  return formatProviderError(normalizeProviderError(error));
}

export function runAssistantStream(
  model: Model<Api>,
  signal: AbortSignal | undefined,
  label: string,
  body: (output: AssistantMessage, stream: AssistantMessageEventStream) => Promise<void>,
  formatError: (error: unknown) => string = formatStreamError,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const output = emptyAssistantOutput(model);

  void (async () => {
    try {
      await body(output, stream);

      if (signal?.aborted) throw new Error("Request was aborted");

      if (output.stopReason === "pending") {
        throw new Error(`${label} stream ended without a stop reason`);
      }

      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
    } catch (error) {
      stripStreamingScratchState(output.content);
      output.stopReason = signal?.aborted ? "aborted" : "error";
      output.errorMessage = formatError(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    }

    stream.end();
  })();

  return stream;
}
