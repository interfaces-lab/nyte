import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import { zstdDecompressSync } from "node:zlib";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const HeadersSchema = Type.Record(Type.String(), Type.String());

const RequestSchema = Type.Object({
  method: Type.String(),
  url: Type.String(),
  headers: HeadersSchema,
  body: Type.Unknown(),
});

const HttpExchangeSchema = Type.Object({
  transport: Type.Literal("http"),
  request: RequestSchema,
  response: Type.Object({
    status: Type.Integer(),
    headers: HeadersSchema,
    chunks: Type.Array(Type.String()),
  }),
});

const FrameSchema = Type.Object({
  from: Type.Union([Type.Literal("client"), Type.Literal("server")]),
  data: Type.String(),
});

const SocketExchangeSchema = Type.Object({
  transport: Type.Literal("websocket"),
  url: Type.String(),
  headers: HeadersSchema,
  frames: Type.Array(FrameSchema),
});

const CassetteSchema = Type.Object({
  version: Type.Literal(1),
  source: Type.Union([
    Type.Object({ kind: Type.Literal("recorded"), at: Type.String() }),
    Type.Object({ kind: Type.Literal("synthesized"), from: Type.Array(Type.String()) }),
  ]),
  exchanges: Type.Array(Type.Union([HttpExchangeSchema, SocketExchangeSchema])),
});

export type Cassette = Static<typeof CassetteSchema>;

type HttpExchange = Static<typeof HttpExchangeSchema>;

type SocketExchange = Static<typeof SocketExchangeSchema>;

type Frame = Static<typeof FrameSchema>;

type RecordedRequest = Static<typeof RequestSchema>;

export type RecorderFetch = typeof globalThis.fetch;

export interface SocketEvent {
  readonly data?: unknown;
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;
  readonly message?: string;
}

export interface RecorderSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: SocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: SocketEvent) => void): void;
}

export type SocketInit =
  | string
  | string[]
  | { readonly headers?: Readonly<Record<string, string>> };

export type RecorderSocketClass = new (url: string | URL, init?: SocketInit) => RecorderSocket;

export interface Recorder extends AsyncDisposable {
  readonly mode: "record" | "replay";
  readonly fetch: RecorderFetch;
  readonly WebSocket: RecorderSocketClass;
  close(): Promise<void>;
}

const REDACTED = "[REDACTED]";

const VOLATILE = "<volatile>";

const MATCHED_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "anthropic-beta",
  "anthropic-version",
  "content-type",
  "openai-beta",
]);

const SECRET_HEADERS: ReadonlySet<string> = new Set([
  "api-key",
  "authorization",
  "chatgpt-account-id",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
]);

const SECRET_PARAMS: ReadonlySet<string> = new Set([
  "access_token",
  "api-key",
  "api_key",
  "apikey",
  "code",
  "key",
  "sig",
  "signature",
  "token",
]);

const SECRET_KEYS: ReadonlySet<string> = new Set([
  "accesstoken",
  "apikey",
  "clientsecret",
  "idtoken",
  "password",
  "refreshtoken",
  "secret",
  "token",
]);

const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "bearer token", pattern: /\bBearer\s+[\w.~+/=-]{16,}/iu },
  { name: "Anthropic or OpenAI key", pattern: /\bsk-[\w-]{20,}/u },
  { name: "Google key", pattern: /\bAIza[\w-]{20,}/u },
  { name: "AWS key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { name: "GitHub token", pattern: /\bgh[pousr]_\w{20,}/u },
  { name: "JWT", pattern: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/u },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
];

const SECRET_ENV = /API|AUTH|BEARER|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN/iu;

const DIFF_LIMIT = 12;

interface Place {
  readonly path: string;
  readonly placeholder: string;
}

export async function openRecorder(input: {
  readonly path: string;
  readonly paths?: Readonly<Record<string, string>>;
  readonly volatile?: readonly string[];
  readonly upstream?: { readonly fetch?: RecorderFetch; readonly WebSocket?: RecorderSocketClass };
}): Promise<Recorder> {
  const places = readPlaces(input.paths ?? {});
  const volatile: ReadonlySet<string> = new Set(input.volatile ?? []);
  const name = basename(input.path);

  if (process.env["NYTE_RECORD"] !== "1") {
    const cassette = await readCassette(input.path);

    return replay({ name, cassette, places, volatile });
  }

  const ci = process.env["CI"];

  if (ci !== undefined && ci !== "" && ci !== "0" && ci !== "false")
    throw new Error(`Refusing to record ${name} in CI: unset CI and record locally.`);

  return record({
    path: input.path,
    places,
    volatile,
    upstream: input.upstream?.fetch ?? globalThis.fetch,
    socket: input.upstream?.WebSocket,
  });
}

async function readCassette(path: string): Promise<Cassette> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null)
    throw new Error(
      `No cassette at ${path}. Record it with NYTE_RECORD=1 and the provider's key in the environment.`,
    );

  const parsed: unknown = JSON.parse(text);

  if (!Value.Check(CassetteSchema, parsed)) {
    const [error] = Value.Errors(CassetteSchema, parsed);

    throw new Error(
      `${path} is not a cassette: ${error?.instancePath ?? ""} ${error?.message ?? ""}`,
    );
  }

  return parsed;
}

function replay(input: {
  readonly name: string;
  readonly cassette: Cassette;
  readonly places: readonly Place[];
  readonly volatile: ReadonlySet<string>;
}): Recorder {
  const { name, cassette, places, volatile } = input;
  const used = new Set<number>();
  const sockets = new Map<number, { readonly frames: number; next: number }>();
  const failures: string[] = [];

  const fail = (message: string): string => {
    failures.push(message);

    return message;
  };

  const fetch = recorderFetch(async (sent) => {
    const seen = readRequest(sent, new Uint8Array(await sent.arrayBuffer()), places, volatile);
    let next: HttpExchange | null = null;

    for (const [index, exchange] of cassette.exchanges.entries()) {
      if (exchange.transport !== "http" || used.has(index)) continue;
      next ??= exchange;

      const recorded = exchange.request;

      if (
        recorded.method !== seen.method ||
        recorded.url !== seen.url ||
        !sameJson(recorded.headers, seen.headers) ||
        JSON.stringify(canonicalJson(recorded.body, volatile, "")) !== JSON.stringify(seen.body)
      )
        continue;
      used.add(index);

      return new Response(
        replayBody(
          exchange.response.chunks.map((chunk) => restorePaths(chunk, places)),
          sent.signal,
        ),
        { status: exchange.response.status, headers: exchange.response.headers },
      );
    }

    const message = fail(
      next === null
        ? `Cassette ${name} has no exchange left for ${seen.method} ${seen.url}.`
        : `Cassette ${name} does not match ${seen.method} ${seen.url}:\n  ${describeMismatch(
            { ...next.request, body: canonicalJson(next.request.body, volatile, "") },
            seen,
          ).join("\n  ")}`,
    );

    return Response.json(
      { type: "error", error: { type: "cassette_mismatch", message } },
      { status: 400 },
    );
  });

  class ReplaySocket implements RecorderSocket {
    readyState = 0;
    readonly #listeners = new Map<string, Set<(event: SocketEvent) => void>>();
    readonly #frames: readonly Frame[];
    readonly #cursor: { readonly frames: number; next: number } | null;

    constructor(url: string | URL, init?: SocketInit) {
      const seen = {
        url: scrubUrl(String(url), places),
        headers: socketHeaders(typeof init === "object" && "headers" in init ? init.headers : {}),
      };

      let claimed: { readonly index: number; readonly exchange: SocketExchange } | null = null;

      for (const [index, exchange] of cassette.exchanges.entries()) {
        if (exchange.transport !== "websocket" || used.has(index)) continue;

        if (exchange.url !== seen.url || !sameJson(exchange.headers, seen.headers)) continue;
        claimed = { index, exchange };
        break;
      }

      if (claimed === null) {
        this.#frames = [];
        this.#cursor = null;
        const message = fail(`Cassette ${name} has no socket exchange for ${seen.url}.`);
        setTimeout(() => this.#end({ message }), 0);

        return;
      }

      used.add(claimed.index);
      this.#frames = claimed.exchange.frames;
      this.#cursor = { frames: this.#frames.length, next: 0 };
      sockets.set(claimed.index, this.#cursor);

      setTimeout(() => {
        this.readyState = 1;
        this.#emit("open", {});
        this.#serve();
      }, 0);
    }

    send(data: string): void {
      const cursor = this.#cursor;
      const expected = cursor === null ? undefined : this.#frames[cursor.next];
      const received = frameText(data, places, volatile);

      if (cursor === null || expected?.from !== "client" || expected.data !== received) {
        const message = fail(
          `Cassette ${name} does not match a socket frame:\n  ${
            expected?.from === "client"
              ? describeMismatch(
                  { method: "SEND", url: "", headers: {}, body: readJson(expected.data) },
                  { method: "SEND", url: "", headers: {}, body: readJson(received) },
                ).join("\n  ")
              : `expected no client frame, received ${show(received)}`
          }`,
        );

        setTimeout(() => this.#end({ message }), 0);

        return;
      }

      cursor.next += 1;
      this.#serve();
    }

    close(code = 1000, reason = ""): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.#emit("close", { code, reason, wasClean: true });
    }

    addEventListener(type: string, listener: (event: SocketEvent) => void): void {
      const listeners = this.#listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: SocketEvent) => void): void {
      this.#listeners.get(type)?.delete(listener);
    }

    #serve(): void {
      const cursor = this.#cursor;
      const frame = cursor === null ? undefined : this.#frames[cursor.next];

      if (cursor === null || frame?.from !== "server") return;
      cursor.next += 1;

      setTimeout(() => {
        if (this.readyState !== 1) return;
        this.#emit("message", { data: restorePaths(frame.data, places) });
        this.#serve();
      }, 0);
    }

    #end(error: { readonly message: string }): void {
      this.#emit("error", error);
      this.readyState = 3;
      this.#emit("close", { code: 1011, reason: error.message, wasClean: false });
    }

    #emit(type: string, event: SocketEvent): void {
      for (const listener of this.#listeners.get(type) ?? []) listener(event);
    }
  }

  const close = async (): Promise<void> => {
    const problems = [...failures];

    for (const [index, exchange] of cassette.exchanges.entries()) {
      if (exchange.transport === "http" && !used.has(index))
        problems.push(
          `Exchange ${index} (${exchange.request.method} ${exchange.request.url}) was never requested.`,
        );

      if (exchange.transport !== "websocket") continue;
      const cursor = sockets.get(index);

      if (cursor === undefined) problems.push(`Socket exchange ${index} was never opened.`);
      else if (cursor.next < cursor.frames)
        problems.push(
          `Socket exchange ${index} stopped at frame ${cursor.next} of ${cursor.frames}.`,
        );
    }

    if (problems.length > 0) throw new Error(`Cassette ${name}:\n${problems.join("\n")}`);
  };

  return {
    mode: "replay",
    fetch,
    WebSocket: ReplaySocket,
    close,
    [Symbol.asyncDispose]: close,
  };
}

function record(input: {
  readonly path: string;
  readonly places: readonly Place[];
  readonly volatile: ReadonlySet<string>;
  readonly upstream: RecorderFetch;
  readonly socket: RecorderSocketClass | undefined;
}): Recorder {
  const { places, volatile, upstream } = input;
  const exchanges: Cassette["exchanges"] = [];
  const streams: Promise<void>[] = [];

  const fetch = recorderFetch(async (sent) => {
    const bytes = new Uint8Array(await sent.arrayBuffer());

    const exchange: HttpExchange = {
      transport: "http",
      request: readRequest(sent, bytes, places, volatile),
      response: { status: 0, headers: {}, chunks: [] },
    };

    exchanges.push(exchange);

    const answer = await upstream(sent.url, {
      method: sent.method,
      headers: Object.fromEntries(sent.headers),
      body: sent.method === "GET" || sent.method === "HEAD" ? null : bytes,
      signal: sent.signal,
    });

    exchange.response.status = answer.status;
    exchange.response.headers = responseHeaders(answer.headers);

    if (answer.body === null) return answer;
    const decoder = new TextDecoder();
    const finished = Promise.withResolvers<void>();
    streams.push(finished.promise);

    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        exchange.response.chunks.push(scrubPaths(decoder.decode(chunk, { stream: true }), places));
        controller.enqueue(chunk);
      },
      flush() {
        const tail = decoder.decode();

        if (tail !== "") exchange.response.chunks.push(scrubPaths(tail, places));
        finished.resolve();
      },
    });

    return new Response(answer.body.pipeThrough(tap), {
      status: answer.status,
      statusText: answer.statusText,
      headers: answer.headers,
    });
  });

  const Upstream = input.socket;

  class RecordingSocket implements RecorderSocket {
    readonly #socket: RecorderSocket;
    readonly #frames: Frame[] = [];

    constructor(url: string | URL, init?: SocketInit) {
      if (Upstream === undefined)
        throw new Error("Recording a socket needs `upstream.WebSocket`, such as the runtime's.");
      this.#socket = new Upstream(url, init);
      exchanges.push({
        transport: "websocket",
        url: scrubUrl(String(url), places),
        headers: socketHeaders(typeof init === "object" && "headers" in init ? init.headers : {}),
        frames: this.#frames,
      });

      this.#socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string")
          throw new Error("Recording a binary socket frame is not supported.");

        this.#frames.push({ from: "server", data: scrubPaths(event.data, places) });
      });
    }

    get readyState(): number {
      return this.#socket.readyState;
    }

    send(data: string): void {
      this.#frames.push({ from: "client", data: frameText(data, places, volatile) });
      this.#socket.send(data);
    }

    close(code?: number, reason?: string): void {
      this.#socket.close(code, reason);
    }

    addEventListener(type: string, listener: (event: SocketEvent) => void): void {
      this.#socket.addEventListener(type, listener);
    }

    removeEventListener(type: string, listener: (event: SocketEvent) => void): void {
      this.#socket.removeEventListener(type, listener);
    }
  }

  const close = async (): Promise<void> => {
    await Promise.all(streams);

    const cassette: Cassette = {
      version: 1,
      source: { kind: "recorded", at: new Date().toISOString() },
      exchanges,
    };

    const text = `${JSON.stringify(cassette, null, 2)}\n`;
    const leaks = findSecrets(text);

    if (leaks.length > 0)
      throw new Error(
        `Not writing ${input.path}: it still holds a ${leaks.join(", ")}. Add its path to \`volatile\`.`,
      );

    await mkdir(dirname(input.path), { recursive: true });
    const staged = `${input.path}.${randomUUID()}.tmp`;
    await writeFile(staged, text);
    await rename(staged, input.path);
  };

  return {
    mode: "record",
    fetch,
    WebSocket: RecordingSocket,
    close,
    [Symbol.asyncDispose]: close,
  };
}

function recorderFetch(handle: (request: Request) => Promise<Response>): RecorderFetch {
  return Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      handle(
        input instanceof Request ? new Request(input, init) : new Request(String(input), init),
      ),
    { preconnect: () => undefined },
  );
}

function findSecrets(text: string): readonly string[] {
  const found = SECRET_PATTERNS.flatMap(({ name, pattern }) => (pattern.test(text) ? [name] : []));

  const leaked = Object.entries(process.env).some(
    ([key, value]) =>
      SECRET_ENV.test(key) && value !== undefined && value.length >= 12 && text.includes(value),
  );

  return leaked ? [...found, "environment value"] : found;
}

function readPlaces(paths: Readonly<Record<string, string>>): readonly Place[] {
  const temp = tmpdir();

  return [
    ...Object.entries(paths).map(([name, path]) => ({ path, placeholder: `<${name}>` })),
    { path: homedir(), placeholder: "<home>" },
    { path: temp, placeholder: "<tmp>" },
    { path: realpathSync(temp), placeholder: "<tmp>" },
  ]
    .filter((place) => place.path.length > 1)
    .toSorted((left, right) => right.path.length - left.path.length);
}

function scrubPaths(text: string, places: readonly Place[]): string {
  let scrubbed = text;

  for (const place of places)
    scrubbed = scrubbed
      .replaceAll(JSON.stringify(place.path).slice(1, -1), place.placeholder)
      .replaceAll(place.path, place.placeholder);

  return scrubbed;
}

function restorePaths(text: string, places: readonly Place[]): string {
  let restored = text;
  const done = new Set<string>();

  for (const place of places) {
    if (done.has(place.placeholder)) continue;
    done.add(place.placeholder);
    restored = restored.replaceAll(place.placeholder, place.path);
  }

  return restored;
}

function scrubUrl(url: string, places: readonly Place[]): string {
  const parsed = new URL(url);

  if (parsed.username !== "") parsed.username = REDACTED;

  if (parsed.password !== "") parsed.password = REDACTED;

  for (const key of new URLSearchParams(parsed.search).keys())
    if (SECRET_PARAMS.has(key.toLowerCase())) parsed.searchParams.set(key, REDACTED);

  return scrubPaths(parsed.href, places);
}

function readRequest(
  request: Request,
  bytes: Uint8Array,
  places: readonly Place[],
  volatile: ReadonlySet<string>,
): RecordedRequest {
  const text = new TextDecoder().decode(
    request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes,
  );

  const headers: Record<string, string> = {};

  for (const [key, value] of request.headers) {
    if (SECRET_HEADERS.has(key)) headers[key] = REDACTED;
    else if (MATCHED_HEADERS.has(key)) headers[key] = value;
  }

  return {
    method: request.method,
    url: scrubUrl(request.url, places),
    headers,
    body: readBody(text, places, volatile),
  };
}

function socketHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const lower = key.toLowerCase();

    if (SECRET_HEADERS.has(lower)) kept[lower] = REDACTED;
    else if (MATCHED_HEADERS.has(lower)) kept[lower] = value;
  }

  return kept;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const [key, value] of headers)
    if (key === "content-type" || key === "retry-after" || key.includes("ratelimit"))
      kept[key] = value;

  return kept;
}

function readBody(text: string, places: readonly Place[], volatile: ReadonlySet<string>): unknown {
  return canonicalJson(readJson(scrubPaths(text, places)), volatile, "");
}

function frameText(text: string, places: readonly Place[], volatile: ReadonlySet<string>): string {
  const body = readBody(text, places, volatile);

  return typeof body === "string" ? body : JSON.stringify(body);
}

function canonicalJson(value: unknown, volatile: ReadonlySet<string>, path: string): unknown {
  if (path !== "" && volatile.has(path)) return VOLATILE;

  const child = (key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

  if (Array.isArray(value))
    return value.map((item: unknown, index) => canonicalJson(item, volatile, child(index)));

  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]: [string, unknown]) =>
        SECRET_KEYS.has(key.replace(/[^a-z0-9]/giu, "").toLowerCase())
          ? [key, REDACTED]
          : [key, canonicalJson(item, volatile, child(key))],
      ),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalJson(left, new Set(), "")) ===
    JSON.stringify(canonicalJson(right, new Set(), ""))
  );
}

function describeMismatch(expected: RecordedRequest, received: RecordedRequest): readonly string[] {
  const lines: string[] = [];

  if (expected.method !== received.method)
    lines.push(`method: expected ${expected.method}, received ${received.method}`);

  if (expected.url !== received.url)
    lines.push(`url: expected ${expected.url}, received ${received.url}`);

  for (const key of new Set([...Object.keys(expected.headers), ...Object.keys(received.headers)]))
    if (expected.headers[key] !== received.headers[key])
      lines.push(
        `header ${key}: expected ${show(expected.headers[key])}, received ${show(received.headers[key])}`,
      );

  diffJson(expected.body, received.body, "body", lines);

  return lines.length > DIFF_LIMIT
    ? [...lines.slice(0, DIFF_LIMIT), `… ${lines.length - DIFF_LIMIT} more`]
    : lines;
}

function readJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return text;
  }
}

function diffJson(expected: unknown, received: unknown, path: string, lines: string[]): void {
  if (Array.isArray(expected) && Array.isArray(received)) {
    for (let index = 0; index < Math.max(expected.length, received.length); index += 1) {
      const left: unknown = expected[index];
      const right: unknown = received[index];
      diffJson(left, right, `${path}.${index}`, lines);
    }

    return;
  }

  if (
    typeof expected === "object" &&
    expected !== null &&
    !Array.isArray(expected) &&
    typeof received === "object" &&
    received !== null &&
    !Array.isArray(received)
  ) {
    const left = new Map<string, unknown>(Object.entries(expected));
    const right = new Map<string, unknown>(Object.entries(received));

    for (const key of new Set([...left.keys(), ...right.keys()]))
      diffJson(left.get(key), right.get(key), `${path}.${key}`, lines);

    return;
  }

  if (JSON.stringify(expected) !== JSON.stringify(received))
    lines.push(`${path}: expected ${show(expected)}, received ${show(received)}`);
}

function show(value: unknown): string {
  if (value === undefined) return "nothing";
  const text = JSON.stringify(value);

  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function replayBody(chunks: readonly string[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (signal.aborted) {
        controller.error(signal.reason);

        return;
      }

      const chunk = chunks[next];
      next += 1;

      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
}
