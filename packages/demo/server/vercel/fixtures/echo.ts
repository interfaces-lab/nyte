import {
  createAssistantMessageEventStream,
  createModels,
  type AssistantMessage,
  type Model,
  type Api,
  type Provider,
} from "@nyte-ai/ai";

export function serverModels() {
  const model: Model<Api> = {
    provider: "fixture",
    id: "echo",
    name: "Deterministic echo",
    api: "fixture",
    baseUrl: "https://fixture.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1_000,
  };

  const stream = (selected: Model<Api>, context: Parameters<Provider["streamSimple"]>[1]) => {
    const input = context.messages.findLast((message) => message.role === "user");

    const content = input?.content ?? "";

    const text = Array.isArray(content)
      ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
      : content;

    const reply = `Fixture reply: ${text}`;

    const empty: AssistantMessage = {
      role: "assistant",
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      content: [],
      stopReason: "pending",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };

    const started: AssistantMessage = {
      ...empty,
      content: [{ type: "text", text: "" }],
    };

    const message: AssistantMessage = {
      ...empty,
      content: [{ type: "text", text: reply }],
      stopReason: "stop",
    };

    const events = createAssistantMessageEventStream();
    events.push({ type: "start", partial: empty });
    events.push({ type: "text_start", contentIndex: 0, partial: started });
    events.push({ type: "text_delta", contentIndex: 0, delta: reply, partial: message });
    events.push({ type: "text_end", contentIndex: 0, content: reply, partial: message });
    events.push({ type: "done", reason: "stop", message });

    return events;
  };

  const models = createModels();
  models.setProvider({
    id: model.provider,
    name: "Fixture",
    auth: { apiKey: { name: "Keyless fixture", resolve: async () => ({ auth: {} }) } },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  });

  return { model, models };
}
