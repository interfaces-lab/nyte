/**
 * Builds the throwaway world the bundled CLI boots into.
 *
 * Everything lives under one sandbox root: its own `UJI_HOME` (auth, settings,
 * trust, model catalog) and its own workspace (files, `.uji/sessions.db`). The
 * real `~/.uji` and the repo's own `.uji/sessions.db` are never opened.
 *
 * Sessions are not hand-written into sqlite. They are produced by driving the
 * real SDK against a scripted `streamFn`, so the transcript the TUI later
 * renders came through the same path a live run uses.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createAssistantMessageEventStream,
  FileCredentialStore,
  FileModelsStore,
} from "@uji-ai/ai";
import type { Api, Model } from "@uji-ai/ai";
import { WorkspaceTrustStore, createUji } from "@uji-ai/core";
import type { ModelCatalog, SessionId, StreamFn } from "@uji-ai/core";
import type { AssistantMessage, ToolCall, Usage } from "@uji-ai/schema";
import type { Scenario, ScriptedReply } from "./scenarios.ts";
import { inlinePlugin, systemPromptPlugin, toolsFsPlugin } from "@uji-ai/core/plugins";
import { SqliteSessionRepo } from "@uji-ai/core/store";

/** The provider the sandbox borrows. It takes an API key and speaks openai-completions. */
export const SANDBOX_PROVIDER = "opencode";
export const SANDBOX_MODEL = "uji-sandbox";

export interface Sandbox {
  root: string;
  home: string;
  workspace: string;
}

const NO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function sandboxModel(baseUrl: string): Model<Api> {
  return {
    id: SANDBOX_MODEL,
    name: "Uji Sandbox",
    api: "openai-completions",
    provider: SANDBOX_PROVIDER,
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  };
}

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: SANDBOX_PROVIDER,
    model: SANDBOX_MODEL,
    usage: NO_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/**
 * Replays one scripted reply as a real event stream: thinking, then text in
 * small deltas, then tool calls. Streaming in pieces matters — a transcript
 * assembled from one atomic message never exercises the incremental paint.
 */
function replyStream(reply: ScriptedReply): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const content: AssistantMessage["content"] = [];
  const partial = assistantMessage(content);
  stream.push({ type: "start", partial });

  if (reply.fail !== undefined) {
    stream.push({
      type: "error",
      reason: "error",
      error: { ...partial, content: [], stopReason: "error", errorMessage: reply.fail },
    });
    return stream;
  }

  let index = 0;
  if (reply.thinking !== undefined) {
    content.push({ type: "thinking", thinking: "" });
    stream.push({ type: "thinking_start", contentIndex: index, partial });
    for (const chunk of chunked(reply.thinking)) {
      const part = content[index];
      if (part?.type === "thinking") part.thinking += chunk;
      stream.push({ type: "thinking_delta", contentIndex: index, delta: chunk, partial });
    }
    stream.push({
      type: "thinking_end",
      contentIndex: index,
      content: reply.thinking,
      partial,
    });
    index += 1;
  }

  if (reply.text !== undefined) {
    content.push({ type: "text", text: "" });
    stream.push({ type: "text_start", contentIndex: index, partial });
    for (const chunk of chunked(reply.text)) {
      const part = content[index];
      if (part?.type === "text") part.text += chunk;
      stream.push({ type: "text_delta", contentIndex: index, delta: chunk, partial });
    }
    stream.push({ type: "text_end", contentIndex: index, content: reply.text, partial });
    index += 1;
  }

  const toolCalls = reply.toolCalls ?? [];
  for (const [callIndex, call] of toolCalls.entries()) {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: `sandbox-${String(Date.now())}-${String(callIndex)}`,
      name: call.name,
      arguments: call.arguments,
    };
    content.push(toolCall);
    stream.push({ type: "toolcall_start", contentIndex: index, partial });
    stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial });
    index += 1;
  }

  stream.push({
    type: "done",
    reason: toolCalls.length > 0 ? "toolUse" : "stop",
    message: { ...partial, stopReason: toolCalls.length > 0 ? "toolUse" : "stop" },
  });
  return stream;
}

/** Split on word boundaries so deltas land like a real token stream. */
function chunked(text: string): string[] {
  return text.match(/\S+\s*|\s+/gu) ?? [text];
}

/** Hands out the scripted replies in order; anything past the script is a stub. */
function scriptedStream(replies: readonly ScriptedReply[]): StreamFn {
  let call = 0;
  return () => {
    const reply = replies[call];
    call += 1;
    return replyStream(reply ?? { text: "(sandbox script exhausted)" });
  };
}

export async function createSandbox(root: string, scenario: Scenario): Promise<Sandbox> {
  const sandbox: Sandbox = {
    root,
    home: join(root, "home"),
    workspace: join(root, "workspace"),
  };
  await mkdir(sandbox.home, { recursive: true, mode: 0o700 });
  await mkdir(sandbox.workspace, { recursive: true });

  for (const [path, contents] of Object.entries(scenario.files)) {
    const target = join(sandbox.workspace, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return sandbox;
}

/**
 * Pre-trust the workspace, pre-authenticate the borrowed provider, and pin the
 * catalog to the local mock. Without all three the TUI opens on a trust prompt
 * or a login screen instead of the transcript we came to look at.
 */
export async function seedHome(sandbox: Sandbox, baseUrl: string): Promise<void> {
  await new WorkspaceTrustStore(join(sandbox.home, "trust.json")).trust(sandbox.workspace);

  await writeFile(
    join(sandbox.home, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: SANDBOX_PROVIDER,
        defaultModel: SANDBOX_MODEL,
        defaultThinkingLevel: "medium",
        autoUpdate: false,
      },
      null,
      2,
    )}\n`,
  );

  await new FileCredentialStore(join(sandbox.home, "auth.json")).modify(
    SANDBOX_PROVIDER,
    async () => ({ type: "api_key", key: "sandbox-key" }),
  );

  await new FileModelsStore(join(sandbox.home, "models-store.json")).write(SANDBOX_PROVIDER, {
    models: [sandboxModel(baseUrl)],
    checkedAt: Date.now(),
  });
}

/**
 * The catalog the sandbox pins: one borrowed provider holding one mock model,
 * already credentialed, so composition never reaches the network.
 */
function sandboxCatalog(model: Model<Api>): ModelCatalog {
  return {
    getModels: () => [model],
    getModel: (provider, id) =>
      provider === SANDBOX_PROVIDER && id === SANDBOX_MODEL ? model : undefined,
    checkAuth: async (providerId) =>
      providerId === SANDBOX_PROVIDER ? { type: "api_key" } : undefined,
    getProvider: (id) => (id === SANDBOX_PROVIDER ? { id } : undefined),
  };
}

/**
 * Replay every scripted session into the sandbox workspace's session database.
 *
 * One `Uji` per turn, because each turn scripts its own replies and `streamFn`
 * is fixed at composition. The store is opened once and handed to each, so the
 * sessions all land in the one database the TUI later opens.
 */
export async function seedSessions(sandbox: Sandbox, scenario: Scenario): Promise<number> {
  const store = new SqliteSessionRepo(join(sandbox.workspace, ".uji", "sessions.db"));
  const model = sandboxModel("http://127.0.0.1:1/v1");
  try {
    for (const scripted of scenario.sessions) {
      let sessionId: SessionId | undefined;
      for (const turn of scripted.turns) {
        const sdk = await createUji({
          store,
          streamFn: scriptedStream(turn.replies),
          models: sandboxCatalog(model),
          model,
          plugins: [
            inlinePlugin(systemPromptPlugin("You are a sandbox fixture.")),
            inlinePlugin(toolsFsPlugin()),
          ],
          env: { cwd: sandbox.workspace },
        });
        const detach = sdk.attach();
        try {
          if (sessionId === undefined) {
            sessionId = (await sdk.sessions.create({ name: scripted.name })).sessionId;
          }
          await sdk.messages.send({
            sessionId,
            content: [{ type: "text", text: turn.prompt }],
          });
          await sdk.runs.wait({ sessionId });
        } finally {
          detach();
          await sdk.close();
        }
      }
    }
    return scenario.sessions.length;
  } finally {
    await store.close();
  }
}
