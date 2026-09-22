import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout } from "node:timers/promises";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { Static } from "typebox";
import type { JsonValue } from "@nyte-ai/schema";
import {
  FIXTURE_API_KEY,
  FIXTURE_CHILD_MODEL,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  FIXTURE_TITLE_MODEL,
} from "./workspace.ts";

const textPart = Type.Object({ type: Type.Literal("text"), text: Type.String() });

const imagePart = Type.Object({
  type: Type.Literal("image_url"),
  image_url: Type.Object({ url: Type.String() }),
});

const requestSchema = Type.Object({
  model: Type.String(),
  stream: Type.Literal(true),
  // OpenAI 6.40 Chat Completions wire values. Off is omitted by this fixture's model.
  reasoning_effort: Type.Optional(
    Type.Union([
      Type.Literal("none"),
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
      Type.Null(),
    ]),
  ),
  messages: Type.Array(
    Type.Object({
      role: Type.String(),
      content: Type.Optional(
        Type.Union([Type.String(), Type.Null(), Type.Array(Type.Union([textPart, imagePart]))]),
      ),
      tool_call_id: Type.Optional(Type.String()),
      tool_calls: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String(),
            type: Type.Literal("function"),
            function: Type.Object({ name: Type.String(), arguments: Type.String() }),
          }),
        ),
      ),
    }),
  ),
  tools: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Literal("function"),
        function: Type.Object({ name: Type.String(), parameters: Type.Unknown() }),
      }),
    ),
  ),
});

const requestParser = Compile(requestSchema);

export type ProviderPayload = Static<typeof requestSchema>;

export type ProviderAction =
  | { readonly kind: "reply"; readonly text: string }
  | { readonly kind: "reasoning"; readonly thinking: string; readonly text: string }
  | { readonly kind: "hold"; readonly text: string; readonly tail?: string }
  | { readonly kind: "fail"; readonly status?: number; readonly message: string }
  | { readonly kind: "tool"; readonly name: string; readonly arguments: Record<string, JsonValue> };

export interface ProviderStep {
  readonly name: string;
  /** Match one of the newest user messages, not the history or the system prompt. */
  readonly prompt?: string;
  readonly model?: string;
  readonly action: ProviderAction;
  /** Prompt tokens reported with the final chunk; the default 20 keeps the footer near 0 %. */
  readonly promptTokens?: number;
}

export interface CapturedRequest {
  readonly id: number;
  readonly model: string;
  readonly prompt: string;
  readonly inputImages: readonly string[];
  readonly payload: ProviderPayload;
  readonly script: string;
}

export interface ProviderEvent {
  readonly requestId: number;
  readonly stage:
    | "received"
    | "streaming"
    | "held"
    | "released"
    | "completed"
    | "aborted"
    | "failed";
  readonly at: number;
}

export interface ProviderController {
  readonly root: string;
  readonly baseUrl: string;
  readonly requests: readonly CapturedRequest[];
  readonly events: readonly ProviderEvent[];
  readonly errors: readonly string[];
  enqueue(...steps: ProviderStep[]): void;
  release(requestId: number, tail?: string): void;
  waitForRequest(
    predicate?: (request: CapturedRequest) => boolean,
    timeoutMs?: number,
  ): Promise<CapturedRequest>;
  waitForStage(requestId: number, stage: ProviderEvent["stage"], timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

type ProviderMessage = ProviderPayload["messages"][number];

interface CompletionDelta {
  readonly role?: "assistant";
  readonly content?: string;
  readonly reasoning_content?: string;
  readonly tool_calls?: readonly {
    readonly index: number;
    readonly id?: string;
    readonly type?: "function";
    readonly function: { readonly name?: string; readonly arguments: string };
  }[];
}

function messageText(message: ProviderMessage): string {
  if (!Array.isArray(message.content)) return message.content ?? "";

  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/**
 * The input this request answers: the newest run of adjacent user messages,
 * newest last. A finished background job lands as a user message beside the
 * message it rides with, and a tool continuation repeats that whole run, so the
 * newest message alone does not name the input a step answers. Everything
 * before the run stays out, so an earlier prompt cannot match a second time.
 */
function newestInputs(messages: readonly ProviderMessage[]): string[] {
  const last = messages.findLastIndex((message) => message.role === "user");

  if (last === -1) return [];
  let first = last;

  while (first > 0 && messages[first - 1]?.role === "user") first -= 1;

  return messages.slice(first, last + 1).map(messageText);
}

/** Chat-completions SSE as consumed by Nyte's installed OpenAI 6.40 adapter.
 * No provider code runs in this process. Requests arrive from the compiled binary.
 */
export async function openProvider(
  steps: readonly ProviderStep[] = [],
): Promise<ProviderController> {
  const queue = [...steps];
  const requests: CapturedRequest[] = [];
  const events: ProviderEvent[] = [];
  const errors: string[] = [];
  const held = new Map<number, (tail?: string) => void>();
  let closed = false;

  const record = (requestId: number, stage: ProviderEvent["stage"]) => {
    events.push({ requestId, stage, at: Date.now() });
  };

  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    // Absolute-form proxy traffic is never forwarded. The fixture has no outbound HTTP client.
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      errors.push(`Blocked ${request.method ?? "unknown"} ${request.url ?? "unknown"}`);
      response.writeHead(403).end("QA accepts only loopback chat completions");

      return;
    }

    if (request.headers.authorization !== `Bearer ${FIXTURE_API_KEY}`) {
      throw new Error("Unexpected provider credentials");
    }

    let body = "";
    request.setEncoding("utf8");

    for await (const part of request) {
      body += String(part);

      if (body.length > 16 * 1024 * 1024) throw new Error("Request exceeds 16 MiB");
    }

    const raw: unknown = JSON.parse(body);

    if (!requestParser.Check(raw))
      throw new Error(
        `Invalid chat-completions request: ${JSON.stringify(requestParser.Errors(raw))}`,
      );
    const payload = raw;
    const inputs = newestInputs(payload.messages);
    const prompt = inputs.at(-1) ?? "";

    const inputImages = payload.messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []))
        : [],
    );

    const index = queue.findIndex((step) => {
      if (step.model !== undefined && step.model !== payload.model) return false;
      const wanted = step.prompt;

      return wanted === undefined || inputs.some((input) => input.includes(wanted));
    });

    const title =
      payload.model === FIXTURE_TITLE_MODEL &&
      payload.messages.some(
        (message) =>
          (message.role === "system" || message.role === "developer") &&
          !Array.isArray(message.content) &&
          message.content?.includes("You are a title generator.") === true,
      );

    const step: ProviderStep | undefined = title
      ? {
          name: "automatic conversation title",
          action: { kind: "reply", text: "QA conversation" },
        }
      : index >= 0
        ? queue.splice(index, 1)[0]
        : undefined;

    const id = requests.length + 1;
    requests.push({
      id,
      model: payload.model,
      prompt,
      inputImages,
      payload,
      script: step?.name ?? "unexpected",
    });
    record(id, "received");
    response.on("close", () => {
      held.delete(id);

      if (!response.writableFinished) record(id, "aborted");
    });

    if (step === undefined)
      throw new Error(`Unscripted request ${id}: ${payload.model}: ${prompt}`);
    const action = step.action;

    if (action.kind === "fail") {
      record(id, "failed");
      response.writeHead(action.status ?? 400, {
        "content-type": "application/json",
        "retry-after": "0",
      });
      response.end(
        JSON.stringify({ error: { message: action.message, type: "qa_error", code: "qa_error" } }),
      );

      return;
    }

    if (
      action.kind === "tool" &&
      !payload.tools?.some((tool) => tool.function.name === action.name)
    ) {
      throw new Error(`The binary did not offer tool ${action.name}`);
    }

    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.flushHeaders();
    record(id, "streaming");
    const created = Math.floor(Date.now() / 1000);

    const chunk = (delta: CompletionDelta, finishReason: "stop" | "tool_calls" | null = null) => {
      response.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-qa-${id}`,
          object: "chat.completion.chunk",
          created,
          model: payload.model,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );
    };

    const finish = (tail = "") => {
      if (response.destroyed || response.writableEnded) return;

      if (tail) chunk({ content: tail });
      chunk({}, action.kind === "tool" ? "tool_calls" : "stop");
      const promptTokens = step.promptTokens ?? 20;
      response.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-qa-${id}`,
          object: "chat.completion.chunk",
          created,
          model: payload.model,
          choices: [],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: 8,
            total_tokens: promptTokens + 8,
          },
        })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
      record(id, "completed");
    };

    chunk({ role: "assistant", content: "" });

    if (action.kind === "tool") {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `qa_call_${id}`,
            type: "function",
            function: { name: action.name, arguments: "" },
          },
        ],
      });
      chunk({
        tool_calls: [{ index: 0, function: { arguments: JSON.stringify(action.arguments) } }],
      });
      finish();

      return;
    }

    if (action.kind === "reasoning") chunk({ reasoning_content: action.thinking });

    if (action.text) chunk({ content: action.text });

    if (action.kind === "reply" || action.kind === "reasoning") {
      finish();

      return;
    }

    held.set(id, (tail) => {
      record(id, "released");
      finish(tail ?? action.tail ?? "");
    });
    record(id, "held");
  };

  const server = createServer((request, response) => {
    void serve(request, response).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push(message);

      if (response.headersSent) response.destroy();
      else
        response
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message } }));
    });
  });

  server.on("connect", (request, socket) => {
    errors.push(`Blocked CONNECT ${request.url ?? "unknown"}`);
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("Expected loopback TCP listener");
  const root = `http://127.0.0.1:${address.port}`;

  const wait = async (predicate: () => boolean, timeoutMs: number, description: string) => {
    const deadline = Date.now() + timeoutMs;

    while (!predicate()) {
      if (closed) throw new Error(`Provider closed while waiting for ${description}`);

      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for ${description}; ${errors.join("; ")}`);
      await setTimeout(10);
    }
  };

  return {
    root,
    baseUrl: `${root}/v1`,
    requests,
    events,
    errors,
    enqueue(...next) {
      if (closed) throw new Error("Provider is closed");
      queue.push(...next);
    },
    release(id, tail) {
      const release = held.get(id);

      if (!release) throw new Error(`Request ${id} is not held`);
      held.delete(id);
      release(tail);
    },
    async waitForRequest(predicate = () => true, timeoutMs = 10_000) {
      await wait(() => requests.some(predicate), timeoutMs, "provider request");
      const request = requests.find(predicate);

      if (!request) throw new Error("Captured request disappeared");

      return request;
    },
    waitForStage(id, stage, timeoutMs = 10_000) {
      return wait(
        () => events.some((event) => event.requestId === id && event.stage === stage),
        timeoutMs,
        `request ${id} ${stage}`,
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      held.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

export function plainReply(text = "QA reply"): ProviderStep {
  return { name: "plain reply", model: FIXTURE_MODEL, action: { kind: "reply", text } };
}

export function thinkingReply(thinking: string, text = "QA thought reply"): ProviderStep {
  return {
    name: "thinking reply",
    model: FIXTURE_MODEL,
    action: { kind: "reasoning", thinking, text },
  };
}

export function subagentRequest(options: {
  readonly background: boolean;
  readonly prompt: string;
}): ProviderStep {
  const taskArguments = {
    model: `${FIXTURE_PROVIDER}/${FIXTURE_CHILD_MODEL}`,
    prompt: options.prompt,
  };

  return {
    name: options.background ? "background subagent" : "foreground subagent",
    model: FIXTURE_MODEL,
    action: {
      kind: "tool",
      name: "task",
      arguments: options.background ? { ...taskArguments, waitMs: 0 } : taskArguments,
    },
  };
}

export function heldReply(text = "QA stream started", tail = " QA stream completed"): ProviderStep {
  return { name: "held stream", model: FIXTURE_MODEL, action: { kind: "hold", text, tail } };
}

export function failedRequest(message = "QA provider failure", status = 400): ProviderStep {
  return {
    name: "provider failure",
    model: FIXTURE_MODEL,
    action: { kind: "fail", status, message },
  };
}

export function retryReply(text = "QA retry completed"): ProviderStep[] {
  return [failedRequest("QA transient failure", 503), plainReply(text)];
}

export function questionRequest(question = "QA question"): ProviderStep {
  return {
    name: "question",
    model: FIXTURE_MODEL,
    action: {
      kind: "tool",
      name: "question",
      arguments: { question, options: [{ label: "First" }, { label: "Second" }] },
    },
  };
}

/** Background bash and task calls become jobs through Nyte's production job wrapper. */
export function bashRequest(command: string, background = false): ProviderStep {
  return {
    name: background ? "background bash" : "foreground bash",
    model: FIXTURE_MODEL,
    action: { kind: "tool", name: "bash", arguments: { command, background } },
  };
}

/** One exact replacement in a seeded workspace file; the card renders the tool's diff. */
export function editRequest(path: string, oldText: string, newText: string): ProviderStep {
  return {
    name: "edit",
    model: FIXTURE_MODEL,
    action: { kind: "tool", name: "edit", arguments: { path, edits: [{ oldText, newText }] } },
  };
}
