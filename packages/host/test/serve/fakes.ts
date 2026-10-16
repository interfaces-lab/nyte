import type { ProviderAuth, SimpleStreamOptions } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels, Provider } from "@nyte-ai/ai/models";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { asId, SdkError } from "@nyte-ai/schema";
import type {
  Authority,
  FileVersion,
  JobEnd,
  OutputFrame,
  PageId,
  PrincipalId,
} from "@nyte-ai/schema";
import type { Api, AssistantMessage, Model, TextContent } from "@nyte-ai/schema/model";
import { memoryStore } from "@nyte-ai/core/store";
import type {
  BrowserApi,
  EnvironmentProvider,
  ExecutionEnv,
  FilesApi,
  Job,
  Page,
  Plugin,
  Store,
} from "@nyte-ai/core";
import { createTransport } from "@nyte-ai/protocol";
import type { Transport } from "@nyte-ai/protocol";
import { composeServer } from "../../../core/src/compose.ts";
import { createHandler } from "../../src/serve/handler.ts";
import type { HandlerOptions } from "../../src/serve/handler.ts";

export type FakeModels = {
  readonly models: MutableModels;
  reply(...texts: readonly string[]): void;
};

export type DiskFile = { readonly contents: Uint8Array; readonly version: FileVersion };

export function fakeModels(): FakeModels {
  const queue: string[] = [];
  let configured = true;

  const auth: ProviderAuth = {
    apiKey: {
      name: "Test key",
      resolve: async () => (configured ? { auth: { apiKey: "key" }, source: "test" } : undefined),
      async login(interaction) {
        const key = await interaction.prompt({ type: "secret", message: "Paste your key." });
        configured = true;

        return { type: "api_key", key };
      },
    },
  };

  const model: Model<Api> = {
    id: "model",
    name: "model",
    api: "test-api",
    provider: "test",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 4_096,
  };

  const respond = (options: SimpleStreamOptions | undefined): AssistantMessageEventStream =>
    replyStream(model, queue.shift() ?? null, options);

  const provider: Provider = {
    id: "test",
    name: "test",
    auth,
    getModels: () => [model],
    stream: () => respond(undefined),
    streamSimple: (_model, _context, options) => respond(options),
  };

  const models = createModels();
  models.setProvider(provider);

  return { models, reply: (...texts) => queue.push(...texts) };
}

export const chatOnly: Plugin<"core"> = {
  id: "chat-only",
  environment: {
    kind: "chat-only",
    inspect: async () => ({
      identity: asId("chat-only"),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async (): Promise<ExecutionEnv> => ({
      identity: asId("chat-only"),
      cwd: "/chat",
      files: refusingFiles(),
      exec: refuse,
      close: async () => undefined,
    }),
  },
};

export function localProvider(
  disk: Map<string, DiskFile>,
  pages: { readonly opened: PageId[]; readonly closed: PageId[] },
): EnvironmentProvider {
  let minted = 0;

  return {
    kind: "local",
    browser: () => fakeBrowser(pages),
    snapshots: () => undefined,
    inspect: async (target) => ({
      identity: asId(`local:${"path" in target ? String(target.path) : "?"}`),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async (target) => {
      const root = "path" in target && typeof target.path === "string" ? target.path : "/";

      const files: FilesApi = {
        ...refusingFiles(),
        async read(path) {
          const file = disk.get(`${root}/${path}`);

          return file === undefined
            ? { kind: "missing", path }
            : {
                kind: "text",
                path,
                contents: new TextDecoder().decode(file.contents),
                version: file.version,
              };
        },
        async bytes(path) {
          const file = disk.get(`${root}/${path}`);

          if (file === undefined) throw new Error(`${path} is missing.`);

          return {
            size: file.contents.byteLength,
            mime: "text/plain",
            version: file.version,
            async *chunks() {
              yield file.contents;
            },
            close: async () => undefined,
            [Symbol.asyncDispose]: async () => undefined,
          };
        },
        async stat(path) {
          const file = disk.get(`${root}/${path}`);

          return file === undefined
            ? null
            : { kind: "file", size: file.contents.byteLength, version: file.version };
        },
        async write(path, contents) {
          minted += 1;
          const version = asId<"file-version">(`v${minted}`);

          const bytes =
            typeof contents === "string" ? new TextEncoder().encode(contents) : contents;

          disk.set(`${root}/${path}`, { contents: bytes, version });

          return { kind: "saved", version };
        },
        async *scan() {
          yield {
            kind: "entries",
            entries: [...disk.entries()]
              .filter(([path]) => path.startsWith(`${root}/`))
              .map(([path, file]) => ({
                path: path.slice(root.length + 1),
                kind: "file" as const,
                size: file.contents.byteLength,
                version: file.version,
              })),
          };
          yield { kind: "complete" };
        },
      };

      return {
        identity: asId(`local:${root}`),
        cwd: root,
        files,
        exec: async (command) => echo(typeof command === "string" ? command : command.join(" ")),
        close: async () => undefined,
      };
    },
  };
}

export async function served(
  options?: Partial<Pick<HandlerOptions, "maxBodyBytes">> & {
    readonly store?: Store;
    readonly plugins?: readonly Plugin<"core">[];
  },
) {
  const fake = fakeModels();
  const disk = new Map<string, DiskFile>();
  const pages = { opened: new Array<PageId>(), closed: new Array<PageId>() };

  const composed = await composeServer({
    store: options?.store ?? memoryStore(),
    models: fake.models,
    plugins: [
      chatOnly,
      { id: "local", environment: localProvider(disk, pages) },
      ...(options?.plugins ?? []),
    ],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });

  const host = { ...composed.host, kernel: composed.kernel };

  const connect = (principal: string, authority: readonly Authority[]) => {
    const granted = new Set(authority);
    const id: PrincipalId = asId(principal);

    return {
      connection: host.server.connect({
        principal: id,
        authority: granted,
        credential: { kind: "token", token: "" },
        origin: null,
      }),
      authority: granted,
    };
  };

  const owner = connect("ada", ["participant", "owner", "maintenance"]);
  const guest = connect("bob", ["participant"]);

  const handler = createHandler({
    server: host.server,
    origins: ["https://app.nyte.dev"],
    maxBodyBytes: options?.maxBodyBytes,
    connection: async (request) => {
      const authorization = request.headers.get("Authorization");

      if (authorization === "Bearer owner") return owner;

      if (authorization === "Bearer guest") return guest;

      if (authorization === "Pairing 123-456")
        return { ...guest, headers: { "X-Nyte-Credential": "device-token" } };

      throw new SdkError("unauthenticated", "The request is not authorized.");
    },
  });

  const transport = (authorization: string): Transport =>
    createTransport({
      url: "http://host.test/",
      headers: async () => ({ Authorization: authorization }),
      fetch: async (input, init) => handler(new Request(input, init)),
    });

  const workspace = await host.workspaces.add({ kind: "local", path: "/work" });

  if (workspace.kind !== "added" && workspace.kind !== "exists")
    throw new Error(`The local workspace was not added: ${workspace.kind}.`);

  return {
    host,
    fake,
    disk,
    pages,
    handler,
    transport,
    workspace: workspace.workspace,
    owner: owner.connection,
  };
}

export function post(
  handler: (request: Request) => Promise<Response>,
  name: string,
  input: unknown,
  headers?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<Response> {
  return handler(
    new Request(`http://host.test/${name}`, {
      method: "POST",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
      signal,
    }),
  );
}

function echo(command: string): Job {
  const frames: OutputFrame[] = command.startsWith("echo ")
    ? [
        { kind: "bytes", data: new TextEncoder().encode(`${command.slice(5)}\n`) },
        { kind: "exit", code: 0 },
      ]
    : [{ kind: "exit", code: 127 }];

  const end: JobEnd = {
    kind: "exited",
    code: command.startsWith("echo ") ? 0 : 127,
    reason: "exited",
  };

  return {
    id: asId("process"),
    key: null,
    write: async () => undefined,
    async *output() {
      yield* frames;
    },
    resize: async () => ({ kind: "not-pty" }),
    idle: async () => true,
    stop: async () => ({ kind: "settled", outcome: end }),
    settled: async () => end,
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}

function fakeBrowser(pages: { readonly opened: PageId[]; readonly closed: PageId[] }): BrowserApi {
  const open = new Map<PageId, Page>();
  const revision = asId<"document-revision">("d1");
  const done = async () => ({ kind: "closed" as const, reason: "released" as const });

  const page = (url: string): Page => {
    const id = asId<"page">(`page-${pages.opened.length + 1}`);
    pages.opened.push(id);

    const close = async () => {
      open.delete(id);
      pages.closed.push(id);
    };

    const created: Page = {
      id,
      view: async () => ({
        id,
        url,
        title: url,
        loading: false,
        revision,
        canGoBack: false,
        canGoForward: false,
      }),
      async *watch() {},
      snapshot: async () => ({ revision, nodes: [] }),
      navigate: done,
      back: done,
      forward: done,
      reload: done,
      stopLoading: done,
      click: async () => ({ kind: "applied", snapshot: { revision, nodes: [] } }),
      type: done,
      press: done,
      scroll: done,
      wait: done,
      console: async () => [],
      capture: async () => ({
        size: 3,
        mime: "image/png",
        async *chunks() {
          yield new Uint8Array([137, 80, 78]);
        },
        close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      }),
      evaluate: async () => ({ kind: "value", value: null }),
      close,
      [Symbol.asyncDispose]: close,
    };

    open.set(id, created);

    return created;
  };

  return {
    open: async (input) => page(input.url),
    async adopt(id) {
      const known = open.get(id);

      if (known === undefined) throw new Error(`No page ${id}.`);

      return known;
    },
    list: async () =>
      [...open.values()].map((known) => ({ id: known.id, url: "", title: "", holders: 1 })),
    async *watch() {},
  };
}

function refusingFiles(): FilesApi {
  return {
    read: refuse,
    bytes: refuse,
    stat: refuse,
    write: refuse,
    remove: refuse,
    batch: () => {
      throw new Error("Core wraps batch.");
    },
    format: refuse,
    scan: refuseStream,
    find: refuse,
    search: refuseStream,
    watch: refuseStream,
    upload: refuse,
  };
}

function replyStream(
  model: Model<Api>,
  text: string | null,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();

  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    await Promise.resolve();
    stream.push({ type: "start", partial: message });

    if (text === null || options?.signal?.aborted === true) {
      stream.push({
        type: "error",
        reason: "error",
        error: { ...message, stopReason: "error", errorMessage: "No reply was scripted." },
      });

      return;
    }

    const content: TextContent = { type: "text", text: "" };
    message.content.push(content);
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    content.text = text;
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message: { ...message, stopReason: "stop" } });
  })();

  return stream;
}

async function refuse(): Promise<never> {
  throw new Error("No environment in tests.");
}

function refuseStream(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
}
