import { normalizeContext } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, test } from "vitest";
import { anthropicMessagesApi } from "../src/api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../src/api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../src/api/openai-responses.lazy.ts";
import type { Api, Context, Model, ProviderStreams, Tool } from "../src/types.ts";

function tool(name: string): Tool {
  return { name, description: `${name} tool`, parameters: Type.Object({}) };
}

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: unknown;
}

async function captureRequest<TApi extends Api>(
  api: ProviderStreams,
  model: Model<TApi>,
  context: Context,
): Promise<CapturedRequest> {
  let captured: CapturedRequest | undefined;
  const result = await api
    .streamSimple(model, normalizeContext(context), {
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        captured = { url: request.url, headers: request.headers, body: await request.json() };
        return new Response("captured", { status: 500 });
      },
    })
    .result();
  if (captured === undefined) throw new Error(result.errorMessage ?? "Expected one request");
  return captured;
}

const modelBase = {
  baseUrl: "http://127.0.0.1:9",
  reasoning: true,
  input: ["text"] satisfies ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
};

const baseTool = tool("base_tool");
const lateTool = tool("late_tool");
const context: Context = {
  messages: [
    {
      role: "system",
      content: "base prompt",
      sections: { rules: "<rules>\nold rules\n</rules>", docs: "<docs>\nread docs\n</docs>" },
      toolsAdded: [baseTool],
      timestamp: 0,
    },
    { role: "user", content: "before", timestamp: 1 },
    {
      role: "system",
      content: "updated guidance",
      sections: { rules: "<rules>\nnew rules\n</rules>", docs: null },
      toolsRemoved: [{ name: "base_tool" }],
      toolsAdded: [lateTool],
      timestamp: 2,
    },
  ],
};
const additionContext: Context = {
  messages: [
    { role: "system", content: "base prompt", toolsAdded: [baseTool], timestamp: 0 },
    { role: "user", content: "before", timestamp: 1 },
    { role: "system", content: "updated guidance", toolsAdded: [lateTool], timestamp: 2 },
  ],
};

const anthropicNativeModel: Model<"anthropic-messages"> = {
  ...modelBase,
  id: "claude-opus-5",
  name: "Claude Opus 5",
  api: "anthropic-messages",
  provider: "anthropic",
  compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true },
};

const MID_CONVERSATION_TOOL_CHANGES_BETA = "mid-conversation-tool-changes-2026-07-01";

const AnthropicPayload = Type.Object({
  system: Type.Optional(Type.Array(Type.Object({ text: Type.String() }))),
  tools: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.Optional(Type.String()),
        defer_loading: Type.Optional(Type.Boolean()),
        cache_control: Type.Optional(Type.Unknown()),
      }),
    ),
  ),
  messages: Type.Array(
    Type.Object({
      role: Type.String(),
      content: Type.Union([
        Type.String(),
        Type.Array(
          Type.Object({
            type: Type.String(),
            text: Type.Optional(Type.String()),
            tool: Type.Optional(Type.Object({ name: Type.String() })),
          }),
        ),
      ]),
    }),
  ),
});

function anthropicPayload(body: unknown) {
  if (!Value.Check(AnthropicPayload, body)) throw new Error("Unexpected Anthropic request body");
  return body;
}

const ResponsesPayload = Type.Object({
  tools: Type.Optional(Type.Array(Type.Object({ name: Type.String() }))),
  input: Type.Array(
    Type.Object({
      type: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      content: Type.Optional(Type.Unknown()),
      tools: Type.Optional(Type.Array(Type.Object({ name: Type.String() }))),
    }),
  ),
});

function responsesPayload(body: unknown) {
  if (!Value.Check(ResponsesPayload, body)) throw new Error("Unexpected Responses request body");
  return body;
}

const CompletionsPayload = Type.Object({
  tools: Type.Optional(
    Type.Array(Type.Object({ function: Type.Optional(Type.Object({ name: Type.String() })) })),
  ),
  messages: Type.Array(
    Type.Object({
      role: Type.String(),
      content: Type.Optional(Type.Unknown()),
      tools: Type.Optional(
        Type.Array(Type.Object({ function: Type.Optional(Type.Object({ name: Type.String() })) })),
      ),
    }),
  ),
});

function completionsPayload(body: unknown) {
  if (!Value.Check(CompletionsPayload, body)) {
    throw new Error("Unexpected Chat Completions request body");
  }
  return body;
}

describe("transcript system messages", () => {
  test("sends Anthropic updates and tool changes in native system messages", async () => {
    const request = await captureRequest(anthropicMessagesApi(), anthropicNativeModel, context);
    const payload = anthropicPayload(request.body);

    expect(request.url).toBe(`${modelBase.baseUrl}/v1/messages?beta=true`);
    expect(request.headers.get("anthropic-beta")).toContain(MID_CONVERSATION_TOOL_CHANGES_BETA);
    expect(payload.system?.map((block) => block.text)).toEqual([
      "base prompt\n\n<rules>\nold rules\n</rules>\n\n<docs>\nread docs\n</docs>",
    ]);
    // Initial tools stay active and carry the cache breakpoint; the placeholder and every
    // later declaration are deferred; the removed tool stays declared.
    expect(payload.tools).toMatchObject([
      { name: "base_tool", cache_control: { type: "ephemeral" } },
      { name: "__pi_deferred_placeholder__", defer_loading: true },
      { name: "late_tool", defer_loading: true },
    ]);
    expect(payload.tools?.[0]?.defer_loading).toBeUndefined();
    expect(payload.tools?.[1]?.cache_control).toBeUndefined();
    expect(payload.tools?.[2]?.cache_control).toBeUndefined();
    const update = payload.messages.at(-1);
    expect(update).toMatchObject({
      role: "system",
      content: [
        { type: "text" },
        { type: "tool_removal", tool: { name: "base_tool" } },
        { type: "tool_addition", tool: { name: "late_tool" } },
      ],
    });
    const updateText = Array.isArray(update?.content) ? update.content[0]?.text : undefined;
    expect(updateText).toContain("updated guidance");
    expect(updateText).toContain("<rules>\nnew rules\n</rules>");
    expect(updateText).toContain('Removed system prompt section "docs"');

    // The placeholder is declared before any change so its scaffolding is cached from request one.
    const initial = anthropicPayload(
      (
        await captureRequest(anthropicMessagesApi(), anthropicNativeModel, {
          messages: context.messages.slice(0, 2),
        })
      ).body,
    );
    expect(initial.tools?.map((entry) => entry.name)).toEqual([
      "base_tool",
      "__pi_deferred_placeholder__",
    ]);
  });

  test("sends the current Anthropic tool list when native tool changes cannot express the history", async () => {
    const redefinedTool = { ...baseTool, description: "changed" };
    const fallbackContexts: Context[] = [
      // Same-name redefinition: blocks reference tools by name only.
      {
        messages: [
          { role: "system", content: "base prompt", toolsAdded: [baseTool], timestamp: 0 },
          {
            role: "system",
            content: "updated guidance",
            toolsRemoved: [{ name: "base_tool" }],
            toolsAdded: [redefinedTool],
            timestamp: 2,
          },
        ],
      },
      // No initial tool: Anthropic rejects an all-deferred tool list.
      {
        messages: [
          { role: "system", content: "base prompt", timestamp: 0 },
          {
            role: "system",
            content: "updated guidance",
            toolsAdded: [redefinedTool],
            timestamp: 2,
          },
        ],
      },
    ];
    for (const fallbackContext of fallbackContexts) {
      const request = await captureRequest(
        anthropicMessagesApi(),
        anthropicNativeModel,
        fallbackContext,
      );
      const payload = anthropicPayload(request.body);
      expect(request.headers.get("anthropic-beta") ?? "").not.toContain(
        MID_CONVERSATION_TOOL_CHANGES_BETA,
      );
      expect(payload.tools).toMatchObject([
        { name: "base_tool", description: "changed", cache_control: { type: "ephemeral" } },
      ]);
      expect(payload.tools?.[0]?.defer_loading).toBeUndefined();
      const last = payload.messages.at(-1)?.content;
      expect(Array.isArray(last) ? last.map((block) => block.type) : last).toEqual(["text"]);
    }
  });

  test("loads tools named by a tool result only when the transcript did not anchor them", async () => {
    const loadedTool = tool("loaded_tool");
    const request = await captureRequest(anthropicMessagesApi(), anthropicNativeModel, {
      messages: [
        {
          role: "system",
          content: "base prompt",
          toolsAdded: [baseTool, loadedTool],
          timestamp: 0,
        },
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_1", name: "base_tool", arguments: {} }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-opus-5",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "base_tool",
          content: [{ type: "text", text: "done" }],
          addedToolNames: ["loaded_tool"],
          isError: false,
          timestamp: 2,
        },
        { role: "system", content: "", toolsAdded: [lateTool], timestamp: 3 },
      ],
    });
    const payload = anthropicPayload(request.body);

    // Native tool changes own every late declaration, so the tool result carries no reference.
    expect(payload.tools?.map((entry) => entry.name)).toEqual([
      "base_tool",
      "loaded_tool",
      "__pi_deferred_placeholder__",
      "late_tool",
    ]);
    expect(JSON.stringify(payload.messages)).not.toContain('tool_reference","tool_name');
    expect(payload.messages.at(-1)).toMatchObject({
      role: "system",
      content: [{ type: "tool_addition", tool: { name: "late_tool" } }],
    });
  });

  test("folds Anthropic updates into the system prompt without native support", async () => {
    const model: Model<"anthropic-messages"> = {
      ...modelBase,
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      api: "anthropic-messages",
      provider: "anthropic",
    };
    const request = await captureRequest(anthropicMessagesApi(), model, context);
    const payload = anthropicPayload(request.body);

    expect(request.headers.get("anthropic-beta") ?? "").not.toContain(
      MID_CONVERSATION_TOOL_CHANGES_BETA,
    );
    expect(payload.system?.map((block) => block.text)).toEqual([
      "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
    ]);
    expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
    expect(payload.messages.map((message) => message.role)).toEqual(["user"]);
  });

  test("requires both Anthropic capabilities for native tool changes", async () => {
    const model: Model<"anthropic-messages"> = {
      ...modelBase,
      id: "claude-opus-5",
      name: "Claude Opus 5",
      api: "anthropic-messages",
      provider: "anthropic",
      compat: { supportsMidConvoToolChanges: true },
    };
    const request = await captureRequest(anthropicMessagesApi(), model, context);
    const payload = anthropicPayload(request.body);

    expect(request.headers.get("anthropic-beta") ?? "").not.toContain(
      MID_CONVERSATION_TOOL_CHANGES_BETA,
    );
    expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
    expect(payload.messages.map((message) => message.role)).toEqual(["user"]);
  });

  test("anchors OpenAI additions at their developer message", async () => {
    const model: Model<"openai-responses"> = {
      ...modelBase,
      id: "gpt-5.4",
      name: "GPT-5.4",
      api: "openai-responses",
      provider: "openai",
      compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
    };
    const payload = responsesPayload(
      (await captureRequest(openAIResponsesApi(), model, additionContext)).body,
    );

    expect(payload.tools?.map((value) => value.name)).toEqual(["base_tool"]);
    expect(
      payload.input
        .find((item) => item.type === "additional_tools")
        ?.tools?.map((value) => value.name),
    ).toEqual(["late_tool"]);
    expect(
      payload.input
        .filter((item) => item.role === "developer" && item.type === undefined)
        .map((item) => item.content),
    ).toEqual(["base prompt", "updated guidance"]);
  });

  test("maps system-message additions into synthetic tool search", async () => {
    const model: Model<"openai-responses"> = {
      ...modelBase,
      id: "gpt-5.4",
      name: "GPT-5.4",
      api: "openai-responses",
      provider: "openai",
      compat: { supportsMidConvoSystemMessages: true, supportsToolSearch: true },
    };
    const payload = responsesPayload(
      (await captureRequest(openAIResponsesApi(), model, additionContext)).body,
    );

    expect(payload.tools?.map((value) => value.name)).toEqual(["base_tool"]);
    expect(payload.input.map((item) => item.type)).toContain("tool_search_call");
    expect(
      payload.input
        .find((item) => item.type === "tool_search_output")
        ?.tools?.map((value) => value.name),
    ).toEqual(["late_tool"]);
  });

  test("folds OpenAI updates into the leading developer message without native support", async () => {
    const model: Model<"openai-responses"> = {
      ...modelBase,
      id: "gpt-4.1",
      name: "GPT-4.1",
      api: "openai-responses",
      provider: "openai",
      compat: { supportsAdditionalTools: true },
    };
    const payload = responsesPayload(
      (await captureRequest(openAIResponsesApi(), model, context)).body,
    );

    expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
    expect(payload.input.map((item) => item.type ?? item.role)).toEqual(["developer", "user"]);
    expect(payload.input[0]?.content).toBe(
      "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
    );
  });

  test("falls back to the complete current tool state when removals are unsupported", async () => {
    const model: Model<"openai-responses"> = {
      ...modelBase,
      id: "gpt-5.4",
      name: "GPT-5.4",
      api: "openai-responses",
      provider: "openai",
      compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
    };
    const payload = responsesPayload(
      (await captureRequest(openAIResponsesApi(), model, context)).body,
    );

    expect(payload.tools?.map((value) => value.name)).toEqual(["late_tool"]);
    expect(payload.input.some((item) => item.type === "additional_tools")).toBe(false);
    expect(payload.input.filter((item) => item.role === "developer")).toHaveLength(2);
  });

  test("anchors Kimi additions in tool-bearing system messages", async () => {
    const model: Model<"openai-completions"> = {
      ...modelBase,
      id: "kimi-k3",
      name: "Kimi K3",
      api: "openai-completions",
      provider: "moonshotai",
      compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true },
    };
    const payload = completionsPayload(
      (await captureRequest(openAICompletionsApi(), model, additionContext)).body,
    );

    expect(payload.tools?.map((value) => value.function?.name)).toEqual(["base_tool"]);
    expect(
      payload.messages
        .find((message) => message.tools)
        ?.tools?.map((value) => value.function?.name),
    ).toEqual(["late_tool"]);
    expect(
      payload.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content),
    ).toEqual(["base prompt", undefined, "updated guidance"]);
  });

  test("keeps Kimi K2 system text inline without dynamic tool messages", async () => {
    const model: Model<"openai-completions"> = {
      ...modelBase,
      id: "kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      api: "openai-completions",
      provider: "moonshotai",
      compat: { supportsMidConvoSystemMessages: true },
    };
    const payload = completionsPayload(
      (await captureRequest(openAICompletionsApi(), model, additionContext)).body,
    );

    expect(payload.tools?.map((value) => value.function?.name)).toEqual(["base_tool", "late_tool"]);
    expect(payload.messages.some((message) => message.tools !== undefined)).toBe(false);
    expect(
      payload.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content),
    ).toEqual(["base prompt", "updated guidance"]);
  });

  test("folds OpenAI-compatible updates into the system prompt without native support", async () => {
    const model: Model<"openai-completions"> = {
      ...modelBase,
      id: "custom-model",
      name: "Custom model",
      api: "openai-completions",
      provider: "custom-provider",
      reasoning: false,
    };
    const payload = completionsPayload(
      (await captureRequest(openAICompletionsApi(), model, context)).body,
    );

    expect(payload.tools?.map((value) => value.function?.name)).toEqual(["late_tool"]);
    expect(payload.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(payload.messages[0]?.content).toBe(
      "base prompt\n\nupdated guidance\n\n<rules>\nnew rules\n</rules>",
    );
  });
});
