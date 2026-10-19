import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { openHost } from "@nyte-ai/host";
import { fakeModels, testModel } from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";
import { TITLE_PROMPT } from "@nyte-ai/plugin/core/rename";
import { normalizeContext } from "@nyte-ai/schema/model";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  TextContent,
  Tool,
  ToolCall,
} from "@nyte-ai/schema/model";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const PLUGIN_ANSWER = "QA plugin answered";

const MODEL = "qa";

export interface TestService extends AsyncDisposable {
  readonly cwd: string;
  reply(...replies: readonly Reply[]): void;
  readonly requests: readonly Request[];
  readonly env: Readonly<Record<string, string>>;
}

const BlockSchema = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  tool_use_id: Type.Optional(Type.String()),
  content: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
    ]),
  ),
});

const BodySchema = Type.Object({
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

function blockText(block: Block): string {
  if (block.text !== undefined) return block.text;
  const content = block.content;

  if (content === undefined) return "";

  return typeof content === "string" ? content : content.map((part) => part.text ?? "").join("\n");
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: MODEL,
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

function context(body: Static<typeof BodySchema>) {
  const messages: Message[] = [];

  for (const message of body.messages) {
    const blocks: readonly Block[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;

    if (message.role === "assistant") {
      messages.push(
        assistant(
          blocks.flatMap((block): (TextContent | ToolCall)[] =>
            block.type === "text"
              ? [{ type: "text" as const, text: block.text ?? "" }]
              : block.type === "tool_use" && block.id !== undefined && block.name !== undefined
                ? [
                    {
                      type: "toolCall" as const,
                      id: block.id,
                      name: block.name,
                      arguments: block.input ?? {},
                    },
                  ]
                : [],
          ),
        ),
      );
      continue;
    }

    for (const block of blocks)
      if (block.type === "tool_result" && block.tool_use_id !== undefined)
        messages.push({
          role: "toolResult",
          toolCallId: block.tool_use_id,
          toolName: "",
          content: [{ type: "text", text: blockText(block) }],
          isError: false,
          timestamp: 0,
        });

    const text = blocks.filter((block) => block.type === "text").map(blockText);

    if (text.length > 0)
      messages.push({
        role: "user",
        content: text.map((part) => ({ type: "text", text: part })),
        timestamp: 0,
      });
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

async function stream(
  events: AsyncIterable<AssistantMessageEvent>,
  response: ServerResponse,
): Promise<void> {
  const open = (): void => {
    if (response.headersSent) return;
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  };

  for await (const event of events) {
    switch (event.type) {
      case "start":
        open();
        frame(response, "message_start", {
          message: {
            id: `msg_${String(Date.now())}`,
            type: "message",
            role: "assistant",
            model: MODEL,
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
      case "text_end":
        frame(response, "content_block_stop", { index: event.contentIndex });
        break;
      case "toolcall_end":
        frame(response, "content_block_start", {
          index: event.contentIndex,
          content_block: {
            type: "tool_use",
            id: event.toolCall.id,
            name: event.toolCall.name,
            input: {},
          },
        });
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
          delta: {
            stop_reason: event.reason === "toolUse" ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: 5 },
        });
        frame(response, "message_stop", {});
        response.end();

        return;
      case "error":
        open();
        frame(response, "error", {
          error: { type: "api_error", message: event.error.errorMessage ?? "Scripted error." },
        });
        response.end();

        return;
      default:
        break;
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

export async function serveForBinary(options: { readonly plugin: boolean }): Promise<TestService> {
  const { root, home, cwd } = await isolate();

  if (options.plugin) {
    const plugin = join(cwd, ".nyte", "plugins", "qa-probe");
    await mkdir(plugin, { recursive: true });
    await writeFile(
      join(plugin, "index.js"),
      `export default {
  id: "qa-probe",
  activate(api) {
    api.contribute.commands.add({
      name: "qa-probe",
      title: "QA probe",
      description: "Show that the project plugin loaded",
      run: () => ${JSON.stringify(PLUGIN_ANSWER)},
    });
  },
};
`,
    );
  }

  const replies: Reply[] = [];
  const requests: Request[] = [];

  const fake = fakeModels({
    id: "anthropic",
    fallback(request) {
      const [first] = request.context.messages;

      if (first?.role === "system" && first.content === TITLE_PROMPT)
        return { content: [{ type: "text", text: "Binary smoke" }] };
      requests.push(request);

      return replies.shift() ?? { error: "No reply was scripted for this request." };
    },
  });

  let origin = "";

  const model = () =>
    testModel(MODEL, {
      name: "QA",
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: origin,
    });

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";

      if (path.endsWith("/catalog/anthropic.json")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify([model()]));

        return;
      }

      if (request.method !== "POST" || !path.endsWith("/v1/messages")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: [] }));

        return;
      }

      const body = Value.Parse(BodySchema, JSON.parse(await readBody(request)));
      const controller = new AbortController();
      response.on("close", () => controller.abort());
      await stream(
        fake.provider.streamSimple(model(), context(body), { signal: controller.signal }),
        response,
      );
    })().catch((cause: unknown) => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ type: "error", error: { type: "api_error", message: String(cause) } }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  origin =
    address !== null && typeof address === "object"
      ? `http://127.0.0.1:${String(address.port)}`
      : "";
  await writeFile(
    join(home, ".nyte", "models-store.json"),
    JSON.stringify({ rawCatalogs: { anthropic: { checkedAt: Date.now(), models: [model()] } } }),
  );

  const env = { ...(await homeEnv(root, home)), NYTE_MODELS_URL: `${origin}/catalog` };
  await seedCredential(home, cwd, `${origin}/catalog`);

  return {
    cwd,
    reply: (...queued) => void replies.push(...queued),
    requests,
    env,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function seedCredential(home: string, cwd: string, catalog: string): Promise<void> {
  const previous = process.env.NYTE_MODELS_URL;
  process.env.NYTE_MODELS_URL = catalog;
  const host = await openHost({ home, workspace: { kind: "local", path: cwd } });

  try {
    const login = host.models.login({
      provider: "anthropic",
      method: { kind: "key" },
      label: "QA",
    });

    for await (const step of login.steps()) if (step.kind === "paste") await login.answer("sk-qa");
    await host.models.setDefault({ provider: "anthropic", id: MODEL });
  } finally {
    await host.close();

    if (previous === undefined) delete process.env.NYTE_MODELS_URL;
    else process.env.NYTE_MODELS_URL = previous;
  }
}

export interface FreshHome extends AsyncDisposable {
  readonly cwd: string;
  readonly nyteHome: string;
  readonly env: Readonly<Record<string, string>>;
}

export async function freshHome(): Promise<FreshHome> {
  const { root, home, cwd } = await isolate();

  return {
    cwd,
    nyteHome: join(home, ".nyte"),
    env: await homeEnv(root, home),
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function homeEnv(root: string, home: string): Promise<Record<string, string>> {
  return {
    HOME: home,
    NYTE_HOME: join(home, ".nyte"),
    NYTE_SKIP_VERSION_CHECK: "1",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "en_US.UTF-8",
    TMPDIR: join(root, "tmp"),
  };
}

async function isolate() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-binary-")));
  const home = join(root, "home");
  const cwd = join(root, "workspace");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(root, "tmp"));
  await writeFile(
    join(home, ".nyte", "settings.json"),
    '{ "autoUpdate": false, "theme": "dark" }\n',
  );

  return { root, home, cwd };
}
