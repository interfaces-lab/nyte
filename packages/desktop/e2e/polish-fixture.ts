import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { pushedCiRepo } from "@nyte-ai/app/e2e/scenario-d";
import {
  prepareScenarioU,
  restaurantReplies,
  restaurantSkill,
} from "@nyte-ai/app/e2e/scenario-u-fixture";
import {
  CI_PROMPT,
  ciHome,
  ciScript,
  fakeModels,
  lastUserText,
  testModel,
  titleReply,
} from "@nyte-ai/bench";
import type { CiRepo, Reply, Request, Script } from "@nyte-ai/bench";
import { contentText, getCurrentTools, normalizeContext } from "@nyte-ai/schema/model";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "@nyte-ai/schema/model";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { scriptedReply } from "../src/main/fixtures/e2e-models.ts";
import { inspectProcessTree, survivors } from "./process-tree.ts";

const POLISH_MODEL = "scripted-polish";

const BlockSchema = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  tool_use_id: Type.Optional(Type.String()),
  is_error: Type.Optional(Type.Boolean()),
  content: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
    ]),
  ),
});

const MessagesRequestSchema = Type.Object({
  system: Type.Optional(Type.Union([Type.String(), Type.Array(BlockSchema)])),
  tools: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.Optional(Type.String()),
        input_schema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
    ),
  ),
  messages: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
      content: Type.Union([Type.String(), Type.Array(BlockSchema)]),
    }),
  ),
});

type Block = Static<typeof BlockSchema>;

function blockText(content: Block["content"]): string {
  if (content === undefined) return "";

  return typeof content === "string"
    ? content
    : content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n");
}

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: POLISH_MODEL,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function readTranscript(body: Static<typeof MessagesRequestSchema>) {
  const names = new Map<string, string>();
  const messages: Message[] = [];

  for (const message of body.messages) {
    const blocks: readonly Block[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;

    if (message.role === "assistant") {
      const content = blocks.flatMap((block): (TextContent | ThinkingContent | ToolCall)[] => {
        if (block.type === "text") return [{ type: "text", text: block.text ?? "" }];

        if (block.type === "thinking")
          return [{ type: "thinking", thinking: block.thinking ?? "" }];

        if (block.type !== "tool_use" || block.id === undefined || block.name === undefined)
          return [];
        names.set(block.id, block.name);

        return [{ type: "toolCall", id: block.id, name: block.name, arguments: block.input ?? {} }];
      });

      messages.push(assistantMessage(content));
      continue;
    }

    const text = blocks.flatMap((block): TextContent[] =>
      block.type === "text" ? [{ type: "text", text: block.text ?? "" }] : [],
    );

    for (const block of blocks) {
      if (block.type !== "tool_result" || block.tool_use_id === undefined) continue;
      messages.push({
        role: "toolResult",
        toolCallId: block.tool_use_id,
        toolName: names.get(block.tool_use_id) ?? "",
        content: [{ type: "text", text: blockText(block.content) }],
        isError: block.is_error === true,
        timestamp: 0,
      });
    }

    if (text.length > 0) messages.push({ role: "user", content: text, timestamp: 0 });
  }

  const system =
    typeof body.system === "string"
      ? body.system
      : (body.system ?? []).map((block) => block.text ?? "").join("\n\n");

  const tools = (body.tools ?? []).map((tool): Tool => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: Type.Unsafe(tool.input_schema ?? {}),
  }));

  return normalizeContext({ systemPrompt: system, tools, messages });
}

function frame(response: ServerResponse, event: string, data: Record<string, unknown>): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function stopReason(event: Extract<AssistantMessageEvent, { type: "done" }>): string {
  if (event.reason === "toolUse") return "tool_use";

  return event.reason === "length" ? "max_tokens" : "end_turn";
}

async function streamAnswer(
  events: AsyncIterable<AssistantMessageEvent>,
  response: ServerResponse,
): Promise<void> {
  const argued = new Set<number>();

  for await (const event of events) {
    switch (event.type) {
      case "start":
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        });
        frame(response, "message_start", {
          message: {
            id: `msg_${String(Date.now())}`,
            type: "message",
            role: "assistant",
            model: POLISH_MODEL,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        });
        break;
      case "text_start":
        frame(response, "content_block_start", {
          index: event.contentIndex,
          content_block: { type: "text", text: "" },
        });
        break;
      case "text_delta":
        frame(response, "content_block_delta", {
          index: event.contentIndex,
          delta: { type: "text_delta", text: event.delta },
        });
        break;
      case "thinking_start":
        frame(response, "content_block_start", {
          index: event.contentIndex,
          content_block: { type: "thinking", thinking: "", signature: "" },
        });
        break;
      case "thinking_delta":
        frame(response, "content_block_delta", {
          index: event.contentIndex,
          delta: { type: "thinking_delta", thinking: event.delta },
        });
        break;
      case "thinking_end":
        frame(response, "content_block_delta", {
          index: event.contentIndex,
          delta: { type: "signature_delta", signature: "polish" },
        });
        frame(response, "content_block_stop", { index: event.contentIndex });
        break;
      case "text_end":
        frame(response, "content_block_stop", { index: event.contentIndex });
        break;
      case "toolcall_start": {
        const call = event.partial.content[event.contentIndex];

        if (call?.type !== "toolCall") break;
        frame(response, "content_block_start", {
          index: event.contentIndex,
          content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
        });
        break;
      }

      case "toolcall_delta":
        argued.add(event.contentIndex);
        frame(response, "content_block_delta", {
          index: event.contentIndex,
          delta: { type: "input_json_delta", partial_json: event.delta },
        });
        break;
      case "toolcall_end":
        if (!argued.has(event.contentIndex))
          frame(response, "content_block_delta", {
            index: event.contentIndex,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(event.toolCall.arguments),
            },
          });
        frame(response, "content_block_stop", { index: event.contentIndex });
        break;
      case "done":
        frame(response, "message_delta", {
          delta: { stop_reason: stopReason(event), stop_sequence: null },
          usage: { output_tokens: 5 },
        });
        frame(response, "message_stop", {});
        response.end();

        return;
      case "error":
        if (!response.headersSent)
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
          });
        if (event.reason === "error")
          frame(response, "error", {
            error: { type: "api_error", message: event.error.errorMessage ?? "Scripted error." },
          });
        response.end();

        return;
    }
  }

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

export interface ScriptedEndpoint {
  readonly origin: string;
  readonly answered: () => number;
  offline: boolean;
  close(): Promise<void>;
}

export async function serveScriptedModel(
  answer: (request: Request) => Reply,
): Promise<ScriptedEndpoint> {
  const fake = fakeModels({ id: "anthropic", fallback: answer });
  let answered = 0;
  let origin = "";

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";

      if (endpoint.offline) {
        request.socket.destroy();

        return;
      }

      if (path.endsWith("/catalog/anthropic.json")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify([polishModel(origin)]));

        return;
      }

      if (request.method !== "POST" || !path.endsWith("/v1/messages")) {
        response.writeHead(path.endsWith("/v1/models") ? 200 : 404, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify({ data: [] }));

        return;
      }

      const body = Value.Parse(MessagesRequestSchema, JSON.parse(await readBody(request)));
      const controller = new AbortController();
      response.on("close", () => controller.abort());
      answered += 1;
      const stream = fake.provider.streamSimple(polishModel(origin), readTranscript(body), {
        signal: controller.signal,
      });
      await streamAnswer(stream, response);
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
  origin = `http://127.0.0.1:${String(address.port)}`;

  const endpoint: ScriptedEndpoint = {
    origin,
    answered: () => answered,
    offline: false,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  return endpoint;
}

export function polishModel(origin: string) {
  return testModel(POLISH_MODEL, {
    name: "Scripted",
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: origin,
  });
}

function opensWith(request: Request, prompt: string): boolean {
  const first = request.context.messages.find((message) => message.role === "user");

  return first?.role === "user" && contentText(first.content, "") === prompt;
}

export function polishAnswers(home: string, places: string): (request: Request) => Reply {
  const restaurant = restaurantReplies({ skill: restaurantSkill(home), origin: places });
  let ci: Script | undefined;

  return (request) => {
    const title = titleReply(request);

    if (title !== null) return { content: [{ type: "text", text: title }] };

    if (opensWith(request, CI_PROMPT)) {
      if (request.context.messages.at(-1)?.role === "user")
        ci = ciScript({
          skill: join(home, ".agents", "skills", "ci-triage", "SKILL.md"),
          route: getCurrentTools(request.context.messages).some(
            (tool) => tool.name === "mcp__ci__list_check_runs",
          )
            ? "mcp"
            : "gh",
        });

      if (ci !== undefined) return ci.answer(request);
    }

    return restaurant(request) ?? scriptedReply(lastUserText(request));
  };
}

export interface PolishHome extends AsyncDisposable {
  readonly home: string;
  readonly repo: CiRepo;
  readonly places: string;
}

const McpFileSchema = Type.Object({
  mcpServers: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
});

export async function polishHome(parent: string, model: string): Promise<PolishHome> {
  const repo = await pushedCiRepo(parent);
  const scenario = await ciHome({ route: "mcp", root: parent });
  const { home } = scenario;
  const ci = Value.Parse(
    McpFileSchema,
    JSON.parse(await readFile(join(home, ".nyte", "mcp.json"), "utf8")),
  );
  const restaurant = await prepareScenarioU(home);
  const places = Value.Parse(
    McpFileSchema,
    JSON.parse(await readFile(join(home, ".nyte", "mcp.json"), "utf8")),
  );
  const servers = { ...ci.mcpServers, ...places.mcpServers };
  await writeFile(join(home, ".nyte", "mcp.json"), JSON.stringify({ mcpServers: servers }));
  await writeFile(join(home, ".nyte", "nyte.json"), JSON.stringify({ mcp: servers }));
  await writeFile(join(home, ".zshrc"), "");
  await mkdir(join(home, "bin"));
  await symlink(process.execPath, join(home, "bin", "node"));
  await writeFile(
    join(home, ".nyte", "models-store.json"),
    JSON.stringify({
      rawCatalogs: { anthropic: { checkedAt: Date.now(), models: [polishModel(model)] } },
    }),
  );

  return {
    home,
    repo,
    places: restaurant.origin,
    [Symbol.asyncDispose]: async () => {
      await restaurant.close();
      await scenario[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

const KEPT = ["SHELL", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "TERM"];

export interface PackagedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly output: readonly string[];
  close(): Promise<void>;
}

export async function launchPackaged(input: {
  readonly executable: string;
  readonly home: string;
  readonly model: string;
  readonly onWindow?: (shown: { application: ElectronApplication; page: Page }) => Promise<void>;
}): Promise<PackagedDesktop> {
  const kept = Object.fromEntries(
    KEPT.flatMap((name) => {
      const value = process.env[name];

      return value === undefined ? [] : [[name, value]];
    }),
  );

  const application = await _electron.launch({
    executablePath: input.executable,
    args: [
      `--user-data-dir=${join(input.home, "Library", "Application Support", "Nyte")}`,
      "--use-mock-keychain",
      "--password-store=basic",
    ],
    env: {
      ...kept,
      PATH: `${join(input.home, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: input.home,
      USERPROFILE: input.home,
      NYTE_MODELS_URL: `${input.model}/catalog`,
    },
    timeout: 30_000,
  });

  const output: string[] = [];
  const child = application.process();

  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => output.push(chunk));
  }

  const close = async (): Promise<void> => {
    const tree = await inspectProcessTree(child.pid);
    await application.close().catch(() => undefined);
    const left = tree === null ? [] : await survivors(tree, 5_000);

    for (const row of left) process.kill(row.pid, "SIGKILL");

    if (left.length > 0)
      throw new Error(
        `The desktop's processes outlived close(): ${left.map((row) => `${String(row.pid)} ${row.command}`).join(", ")}`,
      );
  };

  try {
    const page = await application.firstWindow();
    await input.onWindow?.({ application, page });
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });

    return { application, page, output, close };
  } catch (cause) {
    await close().catch(() => undefined);
    throw cause;
  }
}
