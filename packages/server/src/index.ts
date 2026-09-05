/**
 * `@nyte-ai/server`: a Web `Request -> Response` handler over a `Nyte` SDK.
 *
 * Two routes, both under `/v1`: `POST /v1/call/{verb}` runs one verb from the
 * protocol table, `GET /v1/watch` streams a session's events as server-sent
 * events. The handler never listens on a socket. Hand `server.fetch` to
 * `Bun.serve`, `Deno.serve`, or a Node adapter that builds a `Request` from
 * an incoming message, and bind that listener to a loopback address unless
 * the deployment has its own edge.
 *
 * The handler owns nothing of the SDK's lifecycle. It does not attach a
 * runner, and `close()` stops only the watch streams it opened.
 */
import {
  CursorExpired,
  NyteClosed,
  UnknownSession,
  type Nyte,
  type SessionEvent,
} from "@nyte-ai/core";
import {
  CALL_ROUTE_PREFIX,
  CallRequestSchema,
  EVENT_STREAM_MEDIA_TYPE,
  JSON_MEDIA_TYPE,
  VERBS,
  VERB_NAME_PATTERN,
  WATCH_QUERY,
  WATCH_ROUTE,
  decode,
  describeIssues,
  encodeSseComment,
  encodeSseFrame,
  isVerb,
  schemas,
  sessionId,
  statusFor,
  type CallReply,
  type Issue,
  type Seq,
  type Verb,
  type VerbInput,
  type VerbOutput,
  type WatchFrame,
  type WireError,
} from "@nyte-ai/protocol";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AuthDecision =
  | { readonly kind: "allow" }
  /** `unauthorized` (401) when no credential was presented; `forbidden` (403) when one was refused. */
  | { readonly kind: "deny"; readonly reason: "unauthorized" | "forbidden" };

export type ServerAuth =
  /** `Authorization: Bearer <token>`, compared in constant time. At least 16 characters. */
  | { readonly kind: "token"; readonly token: string }
  /** The host decides per request. It sees the raw request; nothing is read before it answers. */
  | {
      readonly kind: "custom";
      readonly authorize: (request: Request) => AuthDecision | Promise<AuthDecision>;
    };

export interface ServerFailure {
  readonly route: "call" | "watch" | "request";
  readonly verb?: Verb;
  readonly cause: unknown;
}

export interface NyteServerOptions {
  readonly sdk: Nyte;
  readonly auth: ServerAuth;
  /**
   * Origins a browser page may call from, exactly as the `Origin` header
   * spells them. A request whose `Origin` equals the request URL's own origin
   * is always accepted; any other origin not listed here is refused with 403.
   * Behind a proxy that changes the scheme or host, list the public origin.
   */
  readonly browserOrigins?: readonly string[];
  /** Largest call body accepted, in bytes. A positive integer; default 1 MiB. */
  readonly maxBodyBytes?: number;
  /**
   * Interval of SSE comment frames that keep an idle watch open through a
   * proxy with an idle timeout. A non-negative number of milliseconds;
   * default 15 s; 0 sends none.
   */
  readonly heartbeatMs?: number;
  /** Hears every failure a client saw only as `internal`, with its cause. The client never does. */
  readonly onError?: (failure: ServerFailure) => void;
}

export interface NyteServer {
  fetch(request: Request): Promise<Response>;
  /** End every open watch stream with a `closed` error frame. Leaves the SDK untouched. */
  close(): void;
}

const MIN_TOKEN_LENGTH = 16;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_HEARTBEAT_MS = 15_000;
const WATCH_QUERY_KEYS: readonly string[] = Object.values(WATCH_QUERY);
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type Dispatch = {
  readonly [V in Verb]: (sdk: Nyte, input: VerbInput<V>) => Promise<VerbOutput<V>>;
};

/** Every verb in the table, bound to the SDK method it names. A verb missing here fails the build. */
const DISPATCH: Dispatch = {
  landing: (sdk) => Promise.resolve(sdk.landing),
  "sessions.create": (sdk, input) => sdk.sessions.create(input),
  "sessions.get": (sdk, input) => sdk.sessions.get(input),
  "sessions.snapshot": (sdk, input) => sdk.sessions.snapshot(input),
  "sessions.list": (sdk, input) => sdk.sessions.list(input),
  "sessions.rename": (sdk, input) => sdk.sessions.rename(input),
  "sessions.setPinned": (sdk, input) => sdk.sessions.setPinned(input),
  "sessions.setArchived": (sdk, input) => sdk.sessions.setArchived(input),
  "sessions.delete": (sdk, input) => sdk.sessions.delete(input),
  "sessions.configure": (sdk, input) => sdk.sessions.configure(input),
  "messages.send": (sdk, input) => sdk.messages.send(input),
  "messages.cancel": (sdk, input) => sdk.messages.cancel(input),
  "messages.redeliver": (sdk, input) => sdk.messages.redeliver(input),
  "runs.abort": (sdk, input) => sdk.runs.abort(input),
  "runs.changes": (sdk, input) => sdk.runs.changes(input),
  "heads.move": (sdk, input) => sdk.heads.move(input),
  "workspace.list": (sdk) => sdk.workspace.list(),
  "workspace.forget": (sdk, input) => sdk.workspace.forget(input),
  "workspace.vcs.diff": (sdk, input) => sdk.workspace.vcs.diff(input),
  "provider.models.default": (sdk) => sdk.provider.models.default(),
  "plugins.catalog": (sdk) => sdk.plugins.catalog(),
  "plugins.list": (sdk, input) => sdk.plugins.list(input),
  "plugins.commands.list": (sdk, input) => sdk.plugins.commands.list(input),
  "plugins.commands.run": (sdk, input) => sdk.plugins.commands.run(input),
  "plugins.settings.list": (sdk, input) => sdk.plugins.settings.list(input),
  "plugins.settings.apply": (sdk, input) => sdk.plugins.settings.apply(input),
  "plugins.resources.list": (sdk, input) => sdk.plugins.resources.list(input),
};

type VerbResult =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "error"; readonly error: WireError; readonly cause?: unknown };

function invalid(message: string, issues: readonly Issue[] = []): WireError {
  return { code: "invalid_input", message, issues };
}

/**
 * The SDK refuses a lane its landing policy lacks by throwing, and a thrown
 * error is reported as `internal`. The server knows the policy, so it names
 * the mistake first, with a fixed message.
 */
function laneIssue(sdk: Nyte, lane: string | undefined): WireError | undefined {
  if (lane === undefined || sdk.landing.lanes.some((policy) => policy.lane === lane)) {
    return undefined;
  }
  return invalid("Lane is not in the landing policy", [
    { path: "/lane", message: "must be one of the host's lanes" },
  ]);
}

/** Generic in the verb so the input decoded by the verb's schema is the input its method takes. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `raw` is the JSON body; this is its boundary parse
async function runVerb<V extends Verb>(sdk: Nyte, verb: V, raw: unknown): Promise<VerbResult> {
  const input = decode<(typeof VERBS)[V]["input"]>(VERBS[verb].input, raw);
  if (!input.ok) {
    return { kind: "error", error: invalid("Input did not match the verb", input.issues) };
  }
  if (verb === "messages.send" || verb === "messages.redeliver") {
    const lane = decode(schemas.LaneInput, input.value);
    const issue = lane.ok ? laneIssue(sdk, lane.value.lane) : undefined;
    if (issue !== undefined) return { kind: "error", error: issue };
  }
  try {
    return { kind: "value", value: await DISPATCH[verb](sdk, input.value) };
  } catch (cause) {
    return { kind: "error", error: wireErrorFor(cause), cause };
  }
}

/**
 * Only errors the SDK defines are named to the client. Anything else, a
 * `TypeError` from an adapter included, is `internal` with a fixed message;
 * the cause goes to `onError` alone.
 */
function wireErrorFor(cause: unknown): WireError {
  if (cause instanceof UnknownSession) return { code: "unknown_session", message: cause.message };
  if (cause instanceof NyteClosed) return { code: "closed", message: "The host is closed" };
  if (cause instanceof CursorExpired) {
    return { code: "cursor_expired", message: cause.message, floor: cause.floor };
  }
  return { code: "internal", message: "Internal error" };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type OriginDecision =
  | { readonly kind: "absent" }
  | { readonly kind: "same" }
  | { readonly kind: "allowed"; readonly origin: string }
  | { readonly kind: "refused" };

function decideOrigin(
  request: Request,
  url: URL,
  browserOrigins: readonly string[],
): OriginDecision {
  const origin = request.headers.get("origin");
  if (origin === null) return { kind: "absent" };
  if (origin === url.origin) return { kind: "same" };
  if (browserOrigins.includes(origin)) return { kind: "allowed", origin };
  return { kind: "refused" };
}

function corsHeaders(origin: OriginDecision): Headers {
  const headers = new Headers();
  if (origin.kind === "allowed") {
    headers.set("access-control-allow-origin", origin.origin);
    headers.set("vary", "origin");
  }
  return headers;
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const space = header.indexOf(" ");
  if (space === -1) return undefined;
  if (header.slice(0, space).toLowerCase() !== "bearer") return undefined;
  return header.slice(space + 1).trim();
}

/** A host callback is JavaScript; only an explicit allow opens the door. */
function isAllow(decision: AuthDecision): decision is { readonly kind: "allow" } {
  return typeof decision === "object" && decision !== null && decision.kind === "allow";
}

function isDenyReason(
  decision: AuthDecision,
): decision is { readonly kind: "deny"; readonly reason: "unauthorized" | "forbidden" } {
  return (
    typeof decision === "object" &&
    decision !== null &&
    decision.kind === "deny" &&
    (decision.reason === "unauthorized" || decision.reason === "forbidden")
  );
}

function mediaType(header: string | null): string | undefined {
  if (header === null) return undefined;
  const semicolon = header.indexOf(";");
  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

type BodyRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "too_large" }
  | { readonly kind: "not_utf8" };

async function readBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= maxBytes)) return { kind: "too_large" };
  if (request.body === null) return { kind: "text", text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { kind: "not_utf8" };
  }
}

type WatchTarget =
  | { readonly kind: "replay"; readonly afterSeq: Seq | undefined }
  | { readonly kind: "live" };

type WatchQueryParse =
  | { readonly kind: "ok"; readonly sessionId: string; readonly target: WatchTarget }
  | { readonly kind: "invalid"; readonly message: string };

function parseWatchQuery(params: URLSearchParams): WatchQueryParse {
  for (const key of new Set(params.keys())) {
    if (!WATCH_QUERY_KEYS.includes(key))
      return { kind: "invalid", message: `Unknown query key ${key}` };
    if (params.getAll(key).length > 1)
      return { kind: "invalid", message: `Repeated query key ${key}` };
  }
  const id = params.get(WATCH_QUERY.sessionId);
  const after = params.get(WATCH_QUERY.after);
  const live = params.get(WATCH_QUERY.live);
  if (id === null || id === "") return { kind: "invalid", message: "sessionId is required" };
  if (after !== null && live !== null) {
    return { kind: "invalid", message: "after and live are mutually exclusive" };
  }
  if (live !== null) {
    if (live !== "1" && live !== "true") return { kind: "invalid", message: "live must be 1" };
    return { kind: "ok", sessionId: id, target: { kind: "live" } };
  }
  if (after === null) {
    return { kind: "ok", sessionId: id, target: { kind: "replay", afterSeq: undefined } };
  }
  const afterSeq = /^[0-9]{1,16}$/.test(after) ? Number(after) : Number.NaN;
  if (!Number.isSafeInteger(afterSeq)) {
    return { kind: "invalid", message: "after must be a non-negative safe integer" };
  }
  return { kind: "ok", sessionId: id, target: { kind: "replay", afterSeq } };
}

function frameBytes(frame: WatchFrame): Uint8Array {
  switch (frame.kind) {
    case "event":
      return encoder.encode(
        encodeSseFrame({
          event: "event",
          id: String(frame.event.seq),
          data: JSON.stringify(frame.event),
        }),
      );
    case "ended":
      return encoder.encode(encodeSseFrame({ event: "ended", data: "{}" }));
    case "error":
      return encoder.encode(encodeSseFrame({ event: "error", data: JSON.stringify(frame.error) }));
    default: {
      const _exhaustive: never = frame;
      return _exhaustive;
    }
  }
}

/**
 * One `next()` in flight, awaited by any number of pulls. Each pull registers
 * exactly one waiter in a slot the previous pull vacated, so a quiet stream
 * with heartbeats does not pile handlers onto the pending promise.
 */
class PendingNext {
  private settled: IteratorResult<SessionEvent> | undefined;
  private failure: { readonly cause: unknown } | undefined;
  private wake: (() => void) | undefined;

  constructor(promise: Promise<IteratorResult<SessionEvent>>) {
    promise.then(
      (result) => {
        this.settled = result;
        this.wake?.();
      },
      (cause: unknown) => {
        this.failure = { cause };
        this.wake?.();
      },
    );
  }

  /** The result once it exists, else undefined after `waitMs` (forever when 0). Throws what `next()` threw. */
  async wait(waitMs: number): Promise<IteratorResult<SessionEvent> | undefined> {
    if (this.settled === undefined && this.failure === undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = undefined;
          if (timer !== undefined) clearTimeout(timer);
          resolve();
        };
        if (waitMs > 0) timer = setTimeout(() => this.wake?.(), waitMs);
      });
    }
    if (this.failure !== undefined) throw this.failure.cause;
    return this.settled;
  }
}

interface OpenWatch {
  readonly controller: AbortController;
  closing: boolean;
  /** Abort the SDK watch and release its iterator; set once the watch is registered. */
  release: () => void;
}

function validateOptions(options: NyteServerOptions) {
  if (options.auth.kind === "token" && options.auth.token.length < MIN_TOKEN_LENGTH) {
    throw new RangeError(`auth.token must be at least ${String(MIN_TOKEN_LENGTH)} characters`);
  }
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new RangeError("maxBodyBytes must be a positive integer");
  }
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 0) {
    throw new RangeError("heartbeatMs must be a non-negative number");
  }
  return { maxBodyBytes, heartbeatMs };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createNyteServer(options: NyteServerOptions): NyteServer {
  const { sdk, auth } = options;
  const { maxBodyBytes, heartbeatMs } = validateOptions(options);
  const browserOrigins = options.browserOrigins ?? [];
  const watches = new Set<OpenWatch>();
  let closed = false;

  /** A diagnostic hook that throws must not turn a redacted reply into no reply. */
  const report = (failure: ServerFailure): void => {
    try {
      options.onError?.(failure);
    } catch {
      // The failure was already redacted for the client; nowhere else to send it.
    }
  };

  const jsonResponse = (status: number, reply: CallReply, cors: Headers): Response => {
    const headers = new Headers(cors);
    headers.set("content-type", `${JSON_MEDIA_TYPE}; charset=utf-8`);
    headers.set("cache-control", "no-store");
    if (status === 401) headers.set("www-authenticate", "Bearer");
    return new Response(JSON.stringify(reply), { status, headers });
  };

  const refuse = (error: WireError, cors: Headers): Response =>
    jsonResponse(statusFor(error.code), { ok: false, error }, cors);

  const authorize = async (request: Request): Promise<AuthDecision> => {
    switch (auth.kind) {
      case "token": {
        const presented = bearerToken(request);
        if (presented === undefined) return { kind: "deny", reason: "unauthorized" };
        return timingSafeEqual(presented, auth.token)
          ? { kind: "allow" }
          : { kind: "deny", reason: "forbidden" };
      }
      case "custom": {
        const decision = await auth.authorize(request);
        if (isAllow(decision)) return decision;
        return { kind: "deny", reason: isDenyReason(decision) ? decision.reason : "forbidden" };
      }
      default: {
        const _exhaustive: never = auth;
        return _exhaustive;
      }
    }
  };

  const preflight = (origin: OriginDecision): Response => {
    const headers = corsHeaders(origin);
    if (origin.kind === "allowed") {
      headers.set("access-control-allow-methods", "GET, POST");
      headers.set("access-control-allow-headers", "authorization, content-type");
      headers.set("access-control-max-age", "600");
    }
    headers.set("allow", "GET, POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  };

  const call = async (request: Request, verb: Verb, cors: Headers): Promise<Response> => {
    if (mediaType(request.headers.get("content-type")) !== JSON_MEDIA_TYPE) {
      return refuse({ code: "unsupported_media_type", message: `Send ${JSON_MEDIA_TYPE}` }, cors);
    }
    const body = await readBody(request, maxBodyBytes);
    switch (body.kind) {
      case "too_large":
        return refuse(
          { code: "payload_too_large", message: `Body exceeds ${String(maxBodyBytes)} bytes` },
          cors,
        );
      case "not_utf8":
        return refuse(invalid("Body is not valid UTF-8"), cors);
      case "text":
        break;
      default: {
        const _exhaustive: never = body;
        return _exhaustive;
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return refuse(invalid("Body is not valid JSON"), cors);
    }
    const envelope = decode(CallRequestSchema, parsed);
    if (!envelope.ok) {
      return refuse(
        invalid(`Body must be {"input": ...}: ${describeIssues(envelope.issues)}`, envelope.issues),
        cors,
      );
    }
    const input = Object.hasOwn(envelope.value, "input") ? envelope.value.input : undefined;
    const result = await runVerb(sdk, verb, input);
    switch (result.kind) {
      case "value": {
        const reply: CallReply =
          result.value === undefined
            ? { ok: true, defined: false }
            : { ok: true, defined: true, value: result.value };
        try {
          return jsonResponse(200, reply, cors);
        } catch (cause) {
          // A value JSON cannot carry (a bigint, a cycle) is a host bug, not the caller's.
          report({ route: "call", verb, cause });
          return refuse({ code: "internal", message: "Internal error" }, cors);
        }
      }
      case "error":
        if (result.error.code === "internal") report({ route: "call", verb, cause: result.cause });
        return refuse(result.error, cors);
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  };

  const watch = async (request: Request, url: URL, cors: Headers): Promise<Response> => {
    const query = parseWatchQuery(url.searchParams);
    if (query.kind === "invalid") return refuse(invalid(query.message), cors);
    const id = decode(schemas.SessionId, query.sessionId);
    if (!id.ok) return refuse(invalid("Invalid session id", id.issues), cors);
    if (closed) return refuse({ code: "closed", message: "The server is closed" }, cors);
    if (request.signal.aborted) return refuse(invalid("The request was already aborted"), cors);

    const open: OpenWatch = {
      controller: new AbortController(),
      closing: false,
      release: () => undefined,
    };
    const { signal } = open.controller;
    const base = { sessionId: sessionId(id.value), signal };
    const source =
      query.target.kind === "live"
        ? sdk.watch({ ...base, live: true })
        : query.target.afterSeq === undefined
          ? sdk.watch(base)
          : sdk.watch({ ...base, afterSeq: query.target.afterSeq });
    const iterator = source[Symbol.asyncIterator]();
    watches.add(open);

    // Abort the SDK watch first, then let the generator unwind on its own.
    // Awaiting `return()` while a `next()` is pending would wait for the
    // event that never comes.
    const finish = (): void => {
      request.signal.removeEventListener("abort", finish);
      if (!watches.delete(open)) return;
      open.controller.abort();
      void iterator.return?.().catch(() => undefined);
    };
    open.release = finish;
    request.signal.addEventListener("abort", finish, { once: true });

    // The first pull happens before any header is written: a cursor below
    // the floor or an unknown session is a JSON error with a status, not a
    // stream that fails on its first frame.
    let first: IteratorResult<SessionEvent>;
    try {
      first = await iterator.next();
    } catch (cause) {
      finish();
      const error = wireErrorFor(cause);
      if (error.code === "internal") report({ route: "watch", cause });
      return refuse(error, cors);
    }
    if (request.signal.aborted) {
      finish();
      return refuse(invalid("The request was aborted"), cors);
    }

    let pending: PendingNext | undefined;
    let ended = false;
    const end = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      frame: WatchFrame,
    ): void => {
      if (ended) return;
      ended = true;
      controller.enqueue(frameBytes(frame));
      controller.close();
      finish();
    };
    const closedFrame: WatchFrame = {
      kind: "error",
      error: { code: "closed", message: "The server closed the stream" },
    };
    /** An event JSON cannot carry ends the stream as `internal`; it never escapes the stream. */
    const emit = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      event: SessionEvent,
    ): void => {
      let bytes: Uint8Array;
      try {
        bytes = frameBytes({ kind: "event", event });
      } catch (cause) {
        report({ route: "watch", cause });
        end(controller, { kind: "error", error: { code: "internal", message: "Internal error" } });
        return;
      }
      if (!ended) controller.enqueue(bytes);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.done) {
          end(controller, open.closing ? closedFrame : { kind: "ended" });
          return;
        }
        emit(controller, first.value);
      },
      async pull(controller) {
        if (ended) return;
        pending ??= new PendingNext(iterator.next());
        let result: IteratorResult<SessionEvent> | undefined;
        try {
          result = await pending.wait(heartbeatMs);
        } catch (cause) {
          pending = undefined;
          const error = wireErrorFor(cause);
          if (error.code === "internal") report({ route: "watch", cause });
          end(controller, { kind: "error", error });
          return;
        }
        if (ended) return;
        if (result === undefined) {
          controller.enqueue(encoder.encode(encodeSseComment("keepalive")));
          return;
        }
        pending = undefined;
        if (ended) return;
        if (result.done) {
          end(controller, open.closing ? closedFrame : { kind: "ended" });
          return;
        }
        emit(controller, result.value);
      },
      cancel() {
        ended = true;
        finish();
      },
    });

    const headers = new Headers(cors);
    headers.set("content-type", `${EVENT_STREAM_MEDIA_TYPE}; charset=utf-8`);
    headers.set("cache-control", "no-store");
    headers.set("x-accel-buffering", "no");
    return new Response(stream, { status: 200, headers });
  };

  const route = async (
    request: Request,
    url: URL,
    origin: OriginDecision,
    cors: Headers,
  ): Promise<Response> => {
    if (origin.kind === "refused") {
      return refuse({ code: "forbidden", message: "Origin is not allowed" }, cors);
    }
    if (request.method === "OPTIONS") return preflight(origin);

    const decision = await authorize(request);
    if (decision.kind === "deny") {
      return refuse(
        decision.reason === "unauthorized"
          ? { code: "unauthorized", message: "Authentication required" }
          : { code: "forbidden", message: "Credential refused" },
        cors,
      );
    }

    if (url.pathname === WATCH_ROUTE) {
      if (request.method !== "GET") {
        return refuse({ code: "method_not_allowed", message: "Watch is GET" }, cors);
      }
      return watch(request, url, cors);
    }
    if (url.pathname.startsWith(CALL_ROUTE_PREFIX)) {
      if (request.method !== "POST") {
        return refuse({ code: "method_not_allowed", message: "Calls are POST" }, cors);
      }
      const name = url.pathname.slice(CALL_ROUTE_PREFIX.length);
      if (!VERB_NAME_PATTERN.test(name) || !isVerb(name)) {
        return refuse({ code: "unknown_verb", message: `Unknown verb: ${name}` }, cors);
      }
      return call(request, name, cors);
    }
    return refuse({ code: "not_found", message: "No such route" }, cors);
  };

  return {
    async fetch(request) {
      // The origin decision comes first so a redacted failure still carries
      // the CORS headers an approved browser page needs to read it.
      let cors = new Headers();
      try {
        const url = new URL(request.url);
        const origin = decideOrigin(request, url, browserOrigins);
        cors = corsHeaders(origin);
        return await route(request, url, origin, cors);
      } catch (cause) {
        // An auth callback that threw, a body that could not be read, a URL
        // that would not parse: the client hears `internal`, the host hears why.
        report({ route: "request", cause });
        return refuse({ code: "internal", message: "Internal error" }, cors);
      }
    },
    close() {
      closed = true;
      // Release each watch outright. A generator parked at `yield` behind an
      // unread response never sees an abort signal; only `return()` unwinds it.
      for (const open of watches) {
        open.closing = true;
        open.release();
      }
    },
  };
}
