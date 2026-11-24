import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { constants, createDeflateRaw, deflateRawSync } from "node:zlib";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { memoryStore } from "@nyte-ai/core/store";
import { openHost as openLocalHost } from "@nyte-ai/host";
import { PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { CHANNEL_PATH, STREAM_HEADER } from "@nyte-ai/protocol";
import type { SocketLike } from "@nyte-ai/protocol";
import { API_REVISION, asId, isJsonObject, SOCKET_PATH } from "@nyte-ai/schema";
import type { Json, SessionId } from "@nyte-ai/schema";
import { connect as connectClient, createSendJournal, ticketSocket } from "@nyte-ai/sdk/client";
import type { SessionsStore } from "@nyte-ai/sdk/client";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { fakeModels, lastUserText, titleReply } from "../src/index.ts";
import type { Reply, Request } from "../src/index.ts";

const SELF = import.meta.filename;

const SAVED = fileURLToPath(new URL("../wire/loopback.json", import.meta.url));

const parsed = parseArgs({
  options: {
    "idle-ms": { type: "string", default: "60000" },
    json: { type: "string" },
    compare: { type: "string" },
    dump: { type: "string" },
    remote: { type: "boolean", default: false },
    gate: { type: "boolean", default: false },
  },
});

const APP = { tail: 40, page: 200 } as const;

const SEED = { chats: 200, exchanges: 100, renamed: 7 } as const;

const DELTA = { chars: 10, ms: 5, streamed: 4400 } as const;

const QUIET_MS = 750;

const GROWTH_LIMIT = 0.1;

const HOST_HEADER = /^(host:\s*)[^\r\n]*/imu;

const REMOTE_HOST = "nyte-bench.invalid";

const REQUEST_LINE = /^(?:GET|POST|PUT|DELETE|OPTIONS|HEAD) /u;

const DIRECTIONS = ["down", "up"] as const;

const ARROWS = { down: "s→c", up: "c→s" } as const;

const TallySchema = Type.Object({ messages: Type.Number(), bytes: Type.Number() });

const SideSchema = Type.Object({
  bytes: Type.Number(),
  messages: Type.Number(),
  ws: Type.Number(),
  http: Type.Object({ requests: Type.Number(), bytes: Type.Number() }),
  socket: Type.Number(),
  deflate: Type.Object({ alone: Type.Number(), shared: Type.Number() }),
  kinds: Type.Record(Type.String(), TallySchema),
});

const StepSchema = Type.Object({
  title: Type.String(),
  down: SideSchema,
  up: SideSchema,
  extra: Type.Record(Type.String(), Type.Number()),
  sequence: Type.Array(Type.String()),
});

const OptionalText = Type.Union([Type.String(), Type.Null()]);

const ReportSchema = Type.Object({
  commit: Type.String(),
  node: Type.String(),
  deflate: Type.Object({ offered: OptionalText, accepted: OptionalText }),
  steps: Type.Record(Type.String(), StepSchema),
});

const Rows = Type.Object({ upsert: Type.Optional(Type.Array(Type.Unknown())) });

const FrameSchema = Type.Object({
  c: Type.String(),
  type: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  op: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  tables: Type.Optional(Type.Record(Type.String(), Rows)),
  append: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  part: Type.Optional(Type.String()),
});

const EnvelopeSchema = Type.Object({ kind: Type.String(), stream: Type.String() });

const AddressSchema = Type.Object({ port: Type.Number() });

type Report = Static<typeof ReportSchema>;

type Frame = Static<typeof FrameSchema>;

type Direction = "down" | "up";

interface Entry {
  readonly client: string;
  readonly step: string;
  readonly direction: Direction;
  readonly channel: "ws" | "http";
  readonly connection: number;
  readonly kind: string;
  readonly bytes: number;
  readonly text: string;
}

interface Tally {
  readonly up: number;
  readonly down: number;
}

interface Pipe {
  ws: boolean;
  readonly client: Socket;
  readonly upstream: Socket;
}

interface Handshake {
  offered: string | null;
  accepted: string | null;
}

type Proxy = Awaited<ReturnType<typeof openProxy>>;

type Client = Awaited<ReturnType<typeof openClient>>;

type Chat = ReturnType<typeof openChat>;

interface Meter {
  readonly name: string;
  readonly proxy: Proxy;
  step: string;
  last: number;
  flying: number;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly socket: (inner: SocketLike) => SocketLike;
}

interface Deflated {
  readonly alone: number;
  readonly shared: number;
}

const STEPS = [
  { key: "S1", title: "stream text", labels: ["S1"] },
  { key: "S2", title: "tool turn", labels: ["S2"] },
  { key: "S3", title: "cold open, newest screen", labels: ["S3"] },
  { key: "S3.all", title: "cold open, all history", labels: ["S3", "S3.all"] },
  { key: "S4", title: "session list", labels: ["S4"] },
  { key: "S4.title", title: "one title changes", labels: ["S4.title"] },
  { key: "S5", title: "idle", labels: ["S5"] },
  { key: "S6", title: "reconnect", labels: ["S6"] },
] as const;

const GIT = { cwd: import.meta.dirname, encoding: "utf8" } as const;

const entries: Entry[] = [];

const socketSteps = new Map<string, Tally>();

const extras = new Map<string, Record<string, number>>();

async function isolate(): Promise<void> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-bench-wire-")));

  const child = spawn(process.execPath, [...process.execArgv, SELF, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, HOME: home, NYTE_HOME: join(home, ".nyte"), NYTE_BENCH_HOME: home },
  });

  const code = await new Promise<number>((done) => child.once("exit", (exit) => done(exit ?? 1)));
  await rm(home, { recursive: true, force: true, maxRetries: 10 });
  process.exit(code);
}

async function bench(): Promise<void> {
  const home = process.env.NYTE_BENCH_HOME ?? tmpdir();
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  const log = "[12:00:00] step ok\n".repeat(216).slice(0, 4096);
  await writeFile(join(workspace, "build.log"), log);
  const fake = fakeModels({ fallback: answer });
  const base = fake.provider;

  fake.models.setProvider({
    ...base,
    stream: (model, context, options) =>
      paced({ model, context, options: undefined }, base.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      paced({ model, context, options }, base.streamSimple(model, context, options)),
  });

  const host = await openLocalHost({
    store: memoryStore(),
    models: fake.models,
    workspace: { kind: "local", path: workspace },
    home,
  });

  await host.settings.apply(PERMISSIONS, "full");
  const token = crypto.randomUUID();

  const listener = await host.listen({
    transport: { kind: "http", hostname: "127.0.0.1", port: 0 },
    auth: { kind: "token", token },
  });

  if (listener.address === null) throw new Error("The host has no address.");
  const address = listener.address;
  const started = performance.now();
  const streamed = await seed(0, "Seed.");
  const history = await seed(1, exchange(0));

  for (let index = 1; index < SEED.exchanges; index += 1) {
    await (await host.session(history).send(exchange(index))).settled();
  }

  const fillers: SessionId[] = [];

  for (let index = 2; index < SEED.chats; index += 1) fillers.push(await seed(index, "Filler."));
  progress(`seeded ${SEED.chats} chats in ${Math.round(performance.now() - started)} ms`);
  const a = await openClient("A", address, token, "open A");
  const sidebar = a.connection.sessions.open({ parents: { kind: "roots" } });
  const chatA = openChat(a, streamed);
  await settle(a.meter, () => chatA.shown() !== null && fresh(sidebar));

  const turn = (text: string) => async () => {
    const receipt = asId<"receipt">(crypto.randomUUID());
    await a.connection.session(streamed).send(text, { id: receipt, delivery: "steer" });
    await host.session(streamed).receipt(receipt).settled();
  };

  await measure(a.meter, "S1", turn("Go."), () => idle(chatA));
  await measure(a.meter, "S2", turn("Run it."), () => idle(chatA));
  const b = await openClient("B", address, token, "S3");
  const chatH = openChat(b, history);
  const loaded = () => chatH.shown() !== null && chatH.chat.snapshot().freshness.kind === "fresh";
  await settle(b.meter, loaded);
  socketSteps.set("S3", b.meter.proxy.snapshot());
  extras.set("S3", { "window messages": chatH.shown()?.messages.length ?? 0 });
  let pages = 0;

  const page = async () => {
    while ((await chatH.chat.earlier(APP.page)) > 0) pages += 1;
  };

  await measure(b.meter, "S3.all", page);
  const shown = chatH.shown()?.messages.length ?? 0;
  extras.set("S3.all", { "messages shown": shown, "history pages with messages": pages });

  const drop = async () => {
    b.meter.proxy.drop();
    await until(() => b.connection.link.snapshot().kind !== "open", "the drop");
  };

  await measure(
    b.meter,
    "S6",
    drop,
    () => b.connection.link.snapshot().kind === "open" && loaded(),
  );
  chatH.close();
  await b.close();
  await until(() => clientsSeen("A") === 1, "client A to see client B leave");
  const c = await openClient("C", address, token, "S4");
  const list = c.connection.sessions.open({ parents: { kind: "roots" } });
  await settle(c.meter, () => fresh(list));
  socketSteps.set("S4", c.meter.proxy.snapshot());
  extras.set("S4", { "sessions listed": list.snapshot()?.ids.length ?? 0 });
  const renamed = fillers[SEED.renamed] ?? streamed;
  const name = title(SEED.chats + SEED.renamed);

  const rename = async () => {
    await host.session(renamed).update({ name });
  };

  const listed = () => list.snapshot()?.rows.get(renamed)?.name === name;
  await measure(c.meter, "S4.title", rename, listed);
  list.close();
  await c.close();
  await until(() => clientsSeen("A") === 1, "client A to see client C leave");
  await settle(a.meter, () => true);
  const idleMs = Number(parsed.values["idle-ms"]);
  await measure(a.meter, "S5", () => sleep(idleMs));
  chatA.close();
  sidebar.close();
  await a.close();
  const report = await summarize(a.meter.proxy.handshake);
  process.stdout.write(`${formatReport(report)}\n`);

  if (parsed.values.dump !== undefined) {
    const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
    progress(`wrote every message to ${await save(parsed.values.dump, `${lines}\n`)}`);
  }

  if (parsed.values.json !== undefined) {
    progress(`wrote ${await save(parsed.values.json, `${JSON.stringify(report, null, 2)}\n`)}`);
  }
  const against = parsed.values.gate
    ? SAVED
    : parsed.values.compare === undefined
      ? null
      : resolve(process.env.INIT_CWD ?? process.cwd(), parsed.values.compare);

  const failed = against === null ? false : await compare(report, against);
  await listener.close();
  await host.close();
  process.exit(failed ? 1 : 0);

  async function seed(index: number, content: string): Promise<SessionId> {
    const opened = await host.sessions.start({ name: title(index), content });
    await opened.receipt.settled();

    return opened.session.id;
  }
}

function answer(request: Request): Reply {
  const named = titleReply(request);

  const text = (body: string) => ({ type: "text", text: body }) as const;

  if (named !== null) return { content: [text(named)] };
  const asked = lastUserText(request);
  const thinking = { type: "thinking", thinking: "word ".repeat(80) } as const;

  if (asked === "Go.") return { content: [thinking, text("word ".repeat(800))] };

  if (asked === "Run it." && request.context.messages.at(-1)?.role !== "toolResult") {
    const command = { command: "cat build.log && sleep 0.3", description: "Show the build log" };

    return {
      content: [
        {
          type: "toolCall",
          id: "toolu_01WireBenchShellCall0001",
          name: "bash",
          arguments: command,
        },
      ],
    };
  }

  if (asked === "Run it.") return { content: [text("word ".repeat(200))] };
  const numbered = /^Exchange (\d+) /u.exec(asked);

  return { content: [text(numbered === null ? "Ok." : prose(Number(numbered[1]) + 1000, 400))] };
}

function paced(request: Request, source: AssistantMessageEventStream): AssistantMessageEventStream {
  const asked = lastUserText(request);

  if (titleReply(request) !== null || (asked !== "Go." && asked !== "Run it.")) return source;
  const out = new AssistantMessageEventStream();

  void (async () => {
    for await (const event of source) {
      if (event.type !== "text_delta" && event.type !== "thinking_delta") {
        out.push(event);
        continue;
      }

      for (let at = 0; at < event.delta.length; at += DELTA.chars) {
        out.push({ ...event, delta: event.delta.slice(at, at + DELTA.chars) });
        await sleep(DELTA.ms);
      }
    }
  })();

  return out;
}

function prose(seed: number, length: number): string {
  const words = ["build", "cache", "delta", "frame", "graph", "index", "layer", "merge", "patch"];
  const pick = (index: number) => words[(Math.imul(seed * 977 + index, 2_654_435_761) >>> 0) % 9];

  return Array.from({ length }, (_, index) => pick(index))
    .join(" ")
    .slice(0, length)
    .replace(/ $/u, "s");
}

function title(index: number): string {
  return `Chat ${String(index).padStart(3, "0")} ${prose(index + 7000, 31)}`;
}

function exchange(index: number): string {
  return `Exchange ${String(index).padStart(3, "0")} ${prose(index, 27)}`;
}

async function openClient(name: string, address: string, token: string, step: string) {
  const proxy = await openProxy(address);
  const meter = openMeter(name, proxy, step);
  const dial = ticketSocket({ fetch: meter.fetch });

  const connection = await connectClient({
    url: proxy.address,
    credentials: { kind: "token", token },
    client: { kind: "app", name: "Nyte", version: `api-${String(API_REVISION)}` },
    journal: createSendJournal(),
    transport: { fetch: meter.fetch, socket: (request) => meter.socket(dial(request)) },
  });

  void Array.fromAsync(connection.watch());

  const close = async (): Promise<void> => {
    await connection.close();
    await proxy.close();
  };

  return { meter, connection, close };
}

function openChat(client: Client, session: SessionId) {
  const chat = client.connection.chat(session, { tail: APP.tail });
  const leave = chat.subscribe(() => undefined);

  return { chat, shown: () => chat.snapshot().view, close: leave };
}

function clientsSeen(client: string): number {
  const live = '"kind":"live","clients":[';
  const last = entries.findLast((entry) => entry.client === client && entry.text.includes(live));

  return (last?.text.split('"since":').length ?? 1) - 1;
}

function idle(chat: Chat): boolean {
  return chat.shown()?.execution.kind === "idle" && chat.chat.snapshot().freshness.kind === "fresh";
}

function fresh(store: SessionsStore): boolean {
  return store.snapshot() !== null && store.freshness().kind === "fresh";
}

async function measure(
  meter: Meter,
  step: string,
  act: () => Promise<void>,
  ready = () => true,
): Promise<void> {
  meter.step = step;
  const before = meter.proxy.snapshot();
  await act();
  await settle(meter, ready);
  const after = meter.proxy.snapshot();
  socketSteps.set(step, { up: after.up - before.up, down: after.down - before.down });
  meter.step = "between";
}

async function settle(meter: Meter, ready: () => boolean): Promise<void> {
  await until(
    () => ready() && meter.flying === 0 && performance.now() - meter.last >= QUIET_MS,
    `client ${meter.name} to settle ${meter.step}`,
  );
}

async function until(ready: () => boolean, what: string): Promise<void> {
  const started = performance.now();

  while (!ready()) {
    if (performance.now() - started > 120_000) throw new Error(`Waited too long for ${what}.`);
    await sleep(5);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function save(path: string, contents: string): Promise<string> {
  const absolute = resolve(process.env.INIT_CWD ?? process.cwd(), path);
  await writeFile(absolute, contents);

  return absolute;
}

function openMeter(name: string, proxy: Proxy, step: string): Meter {
  const calls = new Map<string, string>();
  const streams = new Map<string, string>();
  let sockets = 0;

  const record = (
    where: Pick<Entry, "direction" | "channel" | "connection">,
    kind: string,
    text: string,
    bytes = Buffer.byteLength(text),
  ): void => {
    meter.last = performance.now();
    entries.push({ ...where, client: name, step: meter.step, kind, bytes, text });
  };

  const httpUp = { direction: "up", channel: "http", connection: 0 } as const;
  const httpDown = { direction: "down", channel: "http", connection: 0 } as const;

  const meter: Meter = {
    name,
    proxy,
    step,
    last: performance.now(),
    flying: 0,
    async fetch(url, init) {
      const op = new URL(url).pathname.slice(1);
      const stream = new Headers(init?.headers).get(STREAM_HEADER);

      if (stream !== null) streams.set(stream, op);
      const sent = init?.body;
      const text = Value.Check(Type.String(), sent) ? sent : "";
      record(httpUp, `http ${op}`, text, sent instanceof Uint8Array ? sent.byteLength : undefined);
      meter.flying += 1;

      const response = await fetch(url, init).finally(() => {
        meter.flying -= 1;
        meter.last = performance.now();
      });

      if (response.body === null) return response;
      const decoder = new TextDecoder();
      let pending = "";

      const seen = (chunk: Uint8Array): void => {
        const read = decoder.decode(chunk, { stream: true });

        if (op !== CHANNEL_PATH) {
          record(httpDown, `http ${op}`, read, chunk.byteLength);

          return;
        }

        const blocks = (pending + read).split("\n\n");
        pending = blocks.pop() ?? "";

        for (const block of blocks) record(httpDown, channelKind(block, streams), `${block}\n\n`);
      };

      const status = { status: response.status, statusText: response.statusText };

      const tap = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen(chunk);
          controller.enqueue(chunk);
        },
      });

      return new Response(response.body.pipeThrough(tap), { ...status, headers: response.headers });
    },
    socket(inner) {
      sockets += 1;
      const connection = sockets;
      const named = (id: string) => calls.get(`${connection}/${id}`) ?? "?";

      inner.addEventListener("message", (event) => {
        const text = Value.Check(Type.String(), event.data) ? event.data : "";
        const where = { direction: "down", channel: "ws", connection } as const;
        record(where, frameKind(readFrame(text), named), text);
      });

      const send = inner.send.bind(inner);

      inner.send = (data) => {
        const frame = readFrame(data);
        const op = frame.op ?? "?";

        if (frame.type === "call") calls.set(`${connection}/${frame.id ?? ""}`, op);
        const kind = frame.type === "call" ? `call ${op}` : (frame.type ?? "?");
        record({ direction: "up", channel: "ws", connection }, kind, data);
        send(data);
      };

      return inner;
    },
  };

  return meter;
}

function channelKind(block: string, streams: ReadonlyMap<string, string>): string {
  if (block.startsWith(":")) return "http stream comment";
  const envelope: unknown = JSON.parse(block.replace(/^data: /u, ""));
  const read = Value.Parse(EnvelopeSchema, envelope);

  return `http stream ${streams.get(read.stream) ?? "?"} ${read.kind}`;
}

function readFrame(text: string): Frame {
  const value: unknown = JSON.parse(text);

  return Value.Parse(FrameSchema, value);
}

function frameKind(frame: Frame, named: (id: string) => string): string {
  if (frame.c === "t") {
    if (frame.append !== undefined) return "text append";

    if (frame.text !== undefined) return "text whole";

    return frame.type === "closed" ? "text closed" : "text progress";
  }

  if (frame.type === "result" || frame.type === "error") {
    return `${frame.type} ${named(frame.id ?? "")}`;
  }

  if (frame.type !== "event") return frame.type ?? "?";
  const scope = (frame.scope ?? "?").split("/")[0] ?? "?";
  const tables = Object.keys(frame.tables ?? {}).toSorted();

  return `event ${frame.kind ?? "?"} ${scope}${tables.length === 0 ? "" : ` ${tables.join("+")}`}`;
}

async function openProxy(target: string) {
  const url = new URL(target);
  const pipes: Pipe[] = [];
  const handshake: Handshake = { offered: null, accepted: null };

  const server = createServer((client) => {
    const upstream = connect(Number(url.port), url.hostname);
    const pipe: Pipe = { ws: false, client, upstream };
    pipes.push(pipe);
    client.setNoDelay(true);
    upstream.setNoDelay(true);

    client.on("data", (chunk: Buffer) => {
      const head = chunk.toString("latin1");

      const renamed = parsed.values.remote && !pipe.ws && REQUEST_LINE.test(head);

      if (!pipe.ws && head.startsWith(`GET ${SOCKET_PATH}`)) {
        pipe.ws = true;
        handshake.offered = extensions(head);
      }

      upstream.write(
        renamed
          ? Buffer.from(head.replace(HOST_HEADER, `$1${REMOTE_HOST}:${url.port}`), "latin1")
          : chunk,
      );
    });

    upstream.on("data", (chunk: Buffer) => {
      const head = chunk.toString("latin1", 0, 12);

      if (pipe.ws && head.startsWith("HTTP/1.1 101")) {
        handshake.accepted = extensions(chunk.toString("latin1"));
      }
      client.write(chunk);
    });

    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });

  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const bound = Value.Parse(AddressSchema, server.address());

  return {
    address: `http://127.0.0.1:${bound.port}`,
    handshake,
    snapshot: (): Tally => ({
      up: pipes.reduce((sum, pipe) => sum + pipe.client.bytesRead, 0),
      down: pipes.reduce((sum, pipe) => sum + pipe.client.bytesWritten, 0),
    }),
    drop() {
      for (const pipe of pipes.filter((each) => each.ws)) {
        pipe.client.destroy();
        pipe.upstream.destroy();
      }
    },
    close: () =>
      new Promise<void>((closed) => {
        for (const pipe of pipes) pipe.client.destroy();
        server.close(() => closed());
      }),
  };
}

function extensions(head: string): string | null {
  const ending = head.indexOf("\r\n\r\n");
  const headers = ending < 0 ? head : head.slice(0, ending);

  return /^sec-websocket-extensions:\s*(.*)$/imu.exec(headers)?.[1]?.trim() ?? null;
}

function asksHost(entry: Entry): boolean {
  return entry.direction === "up" && (entry.channel === "http" || entry.kind.startsWith("call "));
}

async function summarize(handshake: Handshake): Promise<Report> {
  const deflated = await deflateAll();

  const steps = STEPS.map((spec) => {
    const labels: readonly string[] = spec.labels;
    const chosen = entries.filter((entry) => labels.includes(entry.step));
    const sockets = labels.map((label) => socketSteps.get(label));
    const down = side(chosen, "down", sockets, deflated);
    const up = side(chosen, "up", sockets, deflated);
    const extra = { ...extras.get(spec.key) };
    const ws = chosen.filter((entry) => entry.direction === "down" && entry.channel === "ws");

    if (spec.key === "S1") {
      const texts = ws
        .flatMap((entry) => (entry.kind.startsWith("text ") ? [entry.bytes] : []))
        .sort((left, right) => left - right);

      extra["streamed-text messages"] = texts.length;
      extra["streamed-text median bytes"] = quantile(texts, 0.5);
      extra["streamed-text p90 bytes"] = quantile(texts, 0.9);
      extra["overhead ratio"] = Math.round((down.bytes / DELTA.streamed) * 100) / 100;
    }

    if (spec.key === "S2") Object.assign(extra, toolBytes(ws));

    if (spec.key.startsWith("S3") || spec.key === "S6") {
      extra["round trips"] = chosen.filter(asksHost).length;
    }
    const sequence = chosen.flatMap((entry) => (asksHost(entry) ? [entry.kind] : []));
    const step = { title: spec.title, down, up, extra, sequence };

    return [spec.key, step] as const;
  });

  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], GIT).trim(),
    node: process.version,
    deflate: handshake,
    steps: Object.fromEntries(steps),
  };
}

function side(
  chosen: readonly Entry[],
  direction: Direction,
  sockets: readonly (Tally | undefined)[],
  deflated: ReadonlyMap<Entry, Deflated>,
) {
  const picked = chosen.filter((entry) => entry.direction === direction);
  const ws = picked.filter((entry) => entry.channel === "ws");
  const bytes = (list: readonly Entry[]) => list.reduce((sum, entry) => sum + entry.bytes, 0);
  const grouped = Map.groupBy(picked, (entry) => entry.kind).entries();
  const tally = (group: readonly Entry[]) => ({ messages: group.length, bytes: bytes(group) });
  const kinds = Object.fromEntries(grouped.map((pair) => [pair[0], tally(pair[1])]));
  const socket = sockets.reduce((sum, tally) => sum + (tally?.[direction] ?? 0), 0);

  const packed = (pick: (sizes: Deflated) => number): number =>
    ws.reduce((sum, entry) => sum + pick(deflated.get(entry) ?? { alone: 0, shared: 0 }), 0);

  return {
    bytes: bytes(picked),
    messages: ws.length,
    ws: bytes(ws),
    http: {
      requests: chosen.filter((entry) => entry.channel === "http" && asksHost(entry)).length,
      bytes: bytes(picked.filter((entry) => entry.channel === "http")),
    },
    socket,
    deflate: {
      alone: packed((sizes) => sizes.alone),
      shared: packed((sizes) => sizes.shared),
    },
    kinds,
  };
}

function toolBytes(down: readonly Entry[]) {
  const pattern = /"part":"([^"]+)","partKind":"tool"/u;
  const parts = new Set(down.flatMap((entry) => pattern.exec(entry.text)?.slice(1) ?? []));

  const counted = down.map((entry) => {
    const frame = readFrame(entry.text);

    if (frame.c === "t") return parts.has(frame.part ?? "") ? entry.bytes : 0;

    return Object.values(frame.tables ?? {})
      .flatMap((table) => (table.upsert ?? []).map((row) => JSON.stringify(row)))
      .filter((row) => Array.from(parts).some((part) => row.includes(part)))
      .reduce((sum, row) => sum + Buffer.byteLength(row), 0);
  });

  return {
    "tool call bytes": counted.reduce((sum, bytes) => sum + bytes, 0),
    "tool call messages": counted.filter((bytes) => bytes > 0).length,
  };
}

async function deflateAll(): Promise<ReadonlyMap<Entry, Deflated>> {
  const sized = new Map<Entry, Deflated>();
  const ws = entries.filter((entry) => entry.channel === "ws");
  const keyed = (entry: Entry) => `${entry.client}/${String(entry.connection)}/${entry.direction}`;

  for (const group of Map.groupBy(ws, keyed).values()) {
    const shared = createDeflateRaw();
    const out = { shared: 0 };
    shared.on("data", (chunk: Buffer) => (out.shared += chunk.length));

    for (const entry of group) {
      shared.write(entry.text);
      await new Promise<void>((done) => shared.flush(constants.Z_SYNC_FLUSH, () => done()));
      await new Promise<void>((later) => setImmediate(later));
      const alone = deflateRawSync(entry.text, { finishFlush: constants.Z_SYNC_FLUSH }).length - 4;
      sized.set(entry, { alone, shared: out.shared - 4 });
      out.shared = 0;
    }

    shared.end();
  }

  return sized;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0;
}

function formatReport(report: Report): string {
  const steps = Object.entries(report.steps);

  const rows = steps.flatMap((step) =>
    DIRECTIONS.map((direction) => {
      const side = step[1][direction];
      const down = direction === "down";
      const counted = [side.messages, side.ws, down ? "" : side.http.requests, side.http.bytes];
      const sizes = [side.bytes, side.socket, ...Object.values(side.deflate)];
      const named = down ? `${step[0]} ${step[1].title}` : "";

      return [named, ARROWS[direction], ...counted, ...sizes].map(String);
    }),
  );

  const notes = steps.map((step) => {
    const extra = Object.entries(step[1].extra).map((pair) => `${pair[0]} ${pair[1]}`);

    const kinds = DIRECTIONS.flatMap((direction) =>
      Object.entries(step[1][direction].kinds)
        .sort((left, right) => right[1].bytes - left[1].bytes)
        .map((pair) => [
          `  ${ARROWS[direction]} ${pair[0]}`,
          ...[pair[1].messages, pair[1].bytes].map(String),
        ]),
    );

    return [
      `${step[0]} ${step[1].title}`,
      ...(extra.length === 0 ? [] : [`  ${extra.join(" · ")}`]),
      `  requests in order: ${step[1].sequence.join(", ") || "none"}`,
      ...(kinds.length === 0 ? [] : [table(kinds)]),
      "",
    ].join("\n");
  });

  const offered = report.deflate.offered ?? "nothing";
  const accepted = report.deflate.accepted ?? "nothing";

  return [
    `nyte wire bench · node ${report.node} · commit ${report.commit.slice(0, 12)} · ${parsed.values.remote ? "addressed off loopback, so the host compresses" : "loopback listener"}`,
    `permessage-deflate: the client offered ${offered}; the host accepted ${accepted}`,
    "total = WebSocket message payload + HTTP bodies. on socket = every byte on the client's TCP connections: HTTP headers, the upgrade, frame headers, ping/pong. pmd = WebSocket payload deflated, estimated.",
    "",
    table([
      "step|dir|ws msgs|ws bytes|http req|http body|total|on socket|pmd alone|pmd shared".split(
        "|",
      ),
      ...rows,
    ]),
    "",
    "Per step: kind, messages, bytes",
    "",
    ...notes,
  ].join("\n");
}

function table(rows: readonly (readonly string[])[]): string {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );

  const cell = (text: string, column: number) =>
    text[column === 0 ? "padEnd" : "padStart"](widths[column] ?? 0);

  return rows.map((row) => row.map(cell).join("  ")).join("\n");
}

async function compare(report: Report, path: string): Promise<boolean> {
  const saved = Value.Parse(ReportSchema, JSON.parse(await readFile(path, "utf8")));
  const then = new Map(numbers(saved.steps, ""));
  const shown = (value: number | undefined) => (value === undefined ? "-" : String(value));

  const rows = numbers(report.steps, "").map((pair) => {
    const before = then.get(pair[0]);

    return [pair[0], String(pair[1]), shown(before), percent(pair[1], before)];
  });

  const grown = Object.keys(report.steps).filter((key) => {
    const before = saved.steps[key]?.down.bytes ?? Number.POSITIVE_INFINITY;

    return (report.steps[key]?.down.bytes ?? 0) > before * (1 + GROWTH_LIMIT);
  });

  const failures = grown.map(
    (key) => `FAIL: ${key} s→c bytes grew by more than ${String(GROWTH_LIMIT * 100)}%`,
  );
  const against = `against ${path} (commit ${saved.commit.slice(0, 12)}, node ${saved.node})`;
  process.stdout.write(
    `${[`\nnow, then and change ${against}`, table(rows), ...failures].join("\n")}\n`,
  );

  return grown.length > 0;
}

function numbers(value: Json, path: string): (readonly [string, number])[] {
  if (Value.Check(Type.Number(), value)) return [[path.trim(), value]];

  if (!isJsonObject(value)) return [];

  return Object.entries(value).flatMap((pair) => numbers(pair[1], `${path} ${pair[0]}`));
}

function percent(now: number, then: number | undefined): string {
  if (then === undefined || (then === 0 && now !== 0)) return "new";
  const change = then === 0 ? 0 : ((now - then) / then) * 100;

  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function progress(line: string): void {
  process.stderr.write(`${line}\n`);
}

if (process.env.NYTE_BENCH_HOME === undefined) await isolate();
else await bench();
