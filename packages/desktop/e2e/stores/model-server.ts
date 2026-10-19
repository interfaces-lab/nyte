import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const SCRIPTED_MODEL = "scripted";

const BlockSchema = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  tool_use_id: Type.Optional(Type.String()),
  content: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
    ]),
  ),
});

const RequestSchema = Type.Object({
  system: Type.Optional(Type.Union([Type.String(), Type.Array(BlockSchema)])),
  tools: Type.Optional(Type.Array(Type.Object({ name: Type.String() }))),
  messages: Type.Array(
    Type.Object({
      role: Type.String(),
      content: Type.Union([Type.String(), Type.Array(BlockSchema)]),
    }),
  ),
});

type MessagesRequest = Static<typeof RequestSchema>;

type Block = Static<typeof BlockSchema>;

export type Answer =
  | { readonly kind: "hang" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly input: Record<string, unknown> };

export interface Asked {
  readonly user: string;
  readonly tool: string | null;
  readonly title: boolean;
  readonly tools: readonly string[];
}

export interface ModelServer extends AsyncDisposable {
  readonly origin: string;
  readonly asked: readonly Asked[];
  readonly model: Readonly<Record<string, unknown>>;
}

function blocks(content: MessagesRequest["messages"][number]["content"]): readonly Block[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function blockText(block: Block): string {
  if (block.text !== undefined) return block.text;
  const content = block.content;

  if (content === undefined) return "";

  return typeof content === "string" ? content : content.map((part) => part.text ?? "").join("\n");
}

function read(body: MessagesRequest): Asked {
  const system =
    typeof body.system === "string"
      ? body.system
      : (body.system ?? []).map((block) => block.text ?? "").join("\n");

  const last = body.messages.at(-1);
  const lastBlocks = last === undefined ? [] : blocks(last.content);
  const result = lastBlocks.find((block) => block.type === "tool_result");

  const user = body.messages.findLast(
    (message) =>
      message.role === "user" && blocks(message.content).some((block) => block.type === "text"),
  );

  return {
    user:
      user === undefined
        ? ""
        : blocks(user.content)
            .filter((block) => block.type === "text")
            .map(blockText)
            .join("\n"),
    tool: result === undefined ? null : blockText(result),
    title: system.startsWith("You write the title of a conversation"),
    tools: (body.tools ?? []).map((tool) => tool.name),
  };
}

export function defaultScript(asked: Asked): Answer {
  if (asked.title)
    return { kind: "text", text: (asked.user.split("\n")[0] ?? "Chat").slice(0, 40) };

  if (asked.tool !== null)
    return { kind: "text", text: `Tool said: ${asked.tool.trim().split("\n")[0] ?? ""}` };

  if (asked.user.startsWith("HANG")) return { kind: "hang" };

  const directive = /^TOOL (\S+) (.+)$/mu.exec(asked.user);

  if (directive !== null) {
    const parsed: unknown = JSON.parse(directive[2] ?? "{}");

    return {
      kind: "tool",
      name: directive[1] ?? "",
      input: Value.Check(Type.Record(Type.String(), Type.Unknown()), parsed) ? parsed : {},
    };
  }

  return { kind: "text", text: `Echo: ${asked.user.trim()}` };
}

function frame(response: ServerResponse, event: string, data: Record<string, unknown>): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function stream(response: ServerResponse, answer: Answer): void {
  if (answer.kind === "hang") return;
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  frame(response, "message_start", {
    message: {
      id: `msg_${crypto.randomUUID()}`,
      type: "message",
      role: "assistant",
      model: SCRIPTED_MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  });

  if (answer.kind === "text") {
    frame(response, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    frame(response, "content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: answer.text },
    });
    frame(response, "content_block_stop", { index: 0 });
  } else {
    frame(response, "content_block_start", {
      index: 0,
      content_block: {
        type: "tool_use",
        id: `toolu_${crypto.randomUUID().replaceAll("-", "")}`,
        name: answer.name,
        input: {},
      },
    });
    frame(response, "content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(answer.input) },
    });
    frame(response, "content_block_stop", { index: 0 });
  }

  frame(response, "message_delta", {
    delta: { stop_reason: answer.kind === "tool" ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  frame(response, "message_stop", {});
  response.end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function serveModel(
  script: (asked: Asked) => Answer = defaultScript,
): Promise<ModelServer> {
  const asked: Asked[] = [];
  let model: Record<string, unknown> = {};

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";

      if (path.endsWith("/catalog/anthropic.json")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify([model]));

        return;
      }

      if (request.method !== "POST" || !path.endsWith("/v1/messages")) {
        response.writeHead(path.endsWith("/v1/models") ? 200 : 404, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ data: [] }));

        return;
      }

      const question = read(Value.Parse(RequestSchema, JSON.parse(await readBody(request))));
      asked.push(question);
      stream(response, script(question));
    })().catch((cause: unknown) => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ type: "error", error: { type: "api_error", message: String(cause) } }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("The model server has no port.");
  const origin = `http://127.0.0.1:${String(address.port)}`;

  model = {
    id: SCRIPTED_MODEL,
    name: "Scripted",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: origin,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  };

  return {
    origin,
    asked,
    model,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
