/**
 * `@nyte-ai/server`: a Web `Request -> Response` handler over a `Nyte` SDK.
 *
 * Three routes, all under `/v1`: `GET /v1/info` says what is answering,
 * `POST /v1/call/{operation}` runs one operation from the protocol table,
 * `GET /v1/watch` streams a session's events as server-sent events. The
 * handler never listens on a socket. Hand `server.fetch` to `Bun.serve`,
 * `Deno.serve`, or a Node adapter that builds a `Request` from an incoming
 * message, and bind that listener to a loopback address unless the deployment
 * has its own edge.
 *
 * The handler owns nothing of the SDK's lifecycle. It does not attach a
 * runner. `close()` refuses new work and ends its watches, leaving the SDK alone.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  dispatch,
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
  INFO_ROUTE,
  JSON_MEDIA_TYPE,
  OPERATIONS,
  WATCH_QUERY,
  WATCH_ROUTE,
  WIRE_VERSION,
  describeIssues,
  encodeSseComment,
  encodeSseFrame,
  mediaType,
  parseOperation,
  schemas,
  statusFor,
  validationIssues,
  type CallReply,
  type Issue,
  type SessionId,
  type Operation,
  type OperationInput,
  type ServerInfo,
  type ServerDescription,
  ServerDescriptionSchema,
  type WatchInput,
  type WatchFrame,
  type WireError,
} from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const AuthDecisionSchema = Type.Union([
  Type.Object({ kind: Type.Literal("allow") }),
  Type.Object({
    kind: Type.Literal("deny"),
    reason: Type.Enum(["unauthorized", "forbidden"]),
  }),
]);

/** No credential is unauthorized (401); a refused credential is forbidden (403). */
export type AuthDecision = Readonly<Static<typeof AuthDecisionSchema>>;

export type ServerAuth =
  /** `Authorization: Bearer <token>`, compared in constant time. At least 16 characters. */
  | { readonly kind: "token"; readonly token: string }
  /** The host decides per request; its sync or async result is parsed as AuthDecision. */
  | {
      readonly kind: "custom";
      readonly authorize: (request: Request) => unknown;
    };

/** Parsed operation inputs reach policy before any SDK operation runs. Only true grants access. */
export interface ServerPermissions {
  readonly calls: {
    readonly [O in Operation]?: (
      input: OperationInput<O>,
      request: Request,
    ) => boolean | Promise<boolean>;
  };
  readonly watch?: (sessionId: SessionId, request: Request) => boolean | Promise<boolean>;
}

export type ServerFailure = {
  readonly cause: unknown;
} & (
  | { readonly route: "call"; readonly operation: Operation }
  | { readonly route: "watch" | "request"; readonly operation?: never }
);

export interface NyteServerOptions {
  readonly sdk: Nyte;
  /** The host's release, answered on the info route so a client can say what it is attached to. */
  readonly version: string;
  /** Public host metadata, refreshed for authenticated info reads. Omit when the embedding cannot describe it. */
  readonly describe?: () => ServerDescription | Promise<ServerDescription>;
  readonly auth: ServerAuth;
  /** Omit for full access. When supplied, unlisted calls and watches are forbidden. Info stays authenticated. */
  readonly permissions?: ServerPermissions;
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
  /** Refuse new work and end open watches with a `closed` error. Leaves accepted SDK work untouched. */
  close(): void;
}

const MIN_TOKEN_LENGTH = 16;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_HEARTBEAT_MS = 15_000;
const WATCH_QUERY_KEYS: readonly string[] = Object.values(WATCH_QUERY);
const encoder = new TextEncoder();

function invalid(message: string, issues: readonly Issue[] = []): WireError {
  return { code: "invalid_input", message, issues };
}

/**
 * The SDK refuses a lane its landing policy lacks by throwing, and a thrown
 * error is reported as `internal`. The server knows the policy, so it names
 * the mistake first, with a fixed message.
 */
function laneIssue(sdk: Nyte, input: OperationInput<Operation>): WireError | undefined {
  if (input === undefined || !("lane" in input)) return undefined;
  const { lane } = input;
  if (lane === undefined || sdk.landing.lanes.some((policy) => policy.lane === lane)) {
    return undefined;
  }
  return invalid("Lane is not in the landing policy", [
    { path: "/lane", message: "must be one of the host's lanes" },
  ]);
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

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const space = header.indexOf(" ");
  if (space === -1) return undefined;
  if (header.slice(0, space).toLowerCase() !== "bearer") return undefined;
  return header.slice(space + 1).trim();
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

type WatchQueryParse =
  | { readonly kind: "ok"; readonly input: WatchInput }
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
  if (!Value.Check(schemas.SessionId, id)) {
    return { kind: "invalid", message: "sessionId is required" };
  }
  if (after !== null && live !== null) {
    return { kind: "invalid", message: "after and live are mutually exclusive" };
  }
  if (live !== null) {
    if (live !== "1" && live !== "true") return { kind: "invalid", message: "live must be 1" };
    return { kind: "ok", input: { sessionId: id, live: true } };
  }
  if (after === null) {
    return { kind: "ok", input: { sessionId: id } };
  }
  const afterSeq = /^[0-9]{1,16}$/.test(after) ? Number(after) : Number.NaN;
  if (!Number.isSafeInteger(afterSeq)) {
    return { kind: "invalid", message: "after must be a non-negative safe integer" };
  }
  return { kind: "ok", input: { sessionId: id, afterSeq } };
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
  private outcome:
    | { readonly kind: "value"; readonly result: IteratorResult<SessionEvent> }
    | { readonly kind: "error"; readonly cause: unknown }
    | undefined;
  private wake: (() => void) | undefined;

  constructor(promise: Promise<IteratorResult<SessionEvent>>) {
    promise.then(
      (result) => {
        if (this.outcome !== undefined) return;
        this.outcome = { kind: "value", result };
        this.wake?.();
      },
      (cause: unknown) => {
        if (this.outcome !== undefined) return;
        this.outcome = { kind: "error", cause };
        this.wake?.();
      },
    );
  }

  /** Release a pending pull even when the SDK is awaiting work that ignores its signal. */
  stop(): void {
    this.outcome = { kind: "value", result: { done: true, value: undefined } };
    this.wake?.();
  }

  /** The result once it exists, else undefined after `waitMs` (forever when 0). Throws what `next()` threw. */
  async wait(waitMs: number): Promise<IteratorResult<SessionEvent> | undefined> {
    if (this.outcome === undefined) {
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
    if (this.outcome?.kind === "error") throw this.outcome.cause;
    return this.outcome?.result;
  }
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
  const { sdk } = options;
  // Equal-length digests let the native comparison handle tokens of any byte length.
  const auth =
    options.auth.kind === "token"
      ? ({
          kind: "token",
          digest: createHash("sha256").update(options.auth.token).digest(),
        } as const)
      : options.auth;
  const { maxBodyBytes, heartbeatMs } = validateOptions(options);
  const browserOrigins = options.browserOrigins ?? [];
  const watches = new Set<() => void>();
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
        return timingSafeEqual(createHash("sha256").update(presented).digest(), auth.digest)
          ? { kind: "allow" }
          : { kind: "deny", reason: "forbidden" };
      }
      case "custom": {
        const decision = await auth.authorize(request);
        return Value.Check(AuthDecisionSchema, decision)
          ? decision
          : { kind: "deny", reason: "forbidden" };
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

  const call = async <O extends Operation>(
    request: Request,
    operation: O,
    cors: Headers,
  ): Promise<Response> => {
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
    if (!Value.Check(CallRequestSchema, parsed)) {
      const issues = validationIssues(Value.Errors(CallRequestSchema, parsed));
      return refuse(
        invalid(`Body must be {"input": ...}: ${describeIssues(issues)}`, issues),
        cors,
      );
    }
    const schema: (typeof OPERATIONS)[O]["input"] = OPERATIONS[operation].input;
    const input = Object.hasOwn(parsed, "input") ? parsed.input : undefined;
    if (!Value.Check(schema, input)) {
      return refuse(
        invalid("Input did not match the operation", validationIssues(Value.Errors(schema, input))),
        cors,
      );
    }
    try {
      if (
        options.permissions !== undefined &&
        (await options.permissions.calls[operation]?.(input, request)) !== true
      ) {
        return refuse({ code: "forbidden", message: "Operation is not allowed" }, cors);
      }
      if (closed) return refuse({ code: "closed", message: "The server is closed" }, cors);
      const issue = laneIssue(sdk, input);
      if (issue !== undefined) return refuse(issue, cors);
      const value = await dispatch(sdk, operation, input);
      return jsonResponse(
        200,
        value === undefined ? { ok: true, defined: false } : { ok: true, defined: true, value },
        cors,
      );
    } catch (cause) {
      const error = wireErrorFor(cause);
      if (error.code === "internal") report({ route: "call", operation, cause });
      return refuse(error, cors);
    }
  };

  const watch = async (request: Request, url: URL, cors: Headers): Promise<Response> => {
    const query = parseWatchQuery(url.searchParams);
    if (query.kind === "invalid") return refuse(invalid(query.message), cors);
    if (
      options.permissions !== undefined &&
      (await options.permissions.watch?.(query.input.sessionId, request)) !== true
    ) {
      return refuse({ code: "forbidden", message: "Watch is not allowed" }, cors);
    }
    if (closed) return refuse({ code: "closed", message: "The server is closed" }, cors);
    if (request.signal.aborted) return refuse(invalid("The request was already aborted"), cors);

    const watchController = new AbortController();
    const { signal } = watchController;
    const source = sdk.watch({ ...query.input, signal });
    const iterator = source[Symbol.asyncIterator]();
    const firstRead = Promise.withResolvers<IteratorResult<SessionEvent>>();
    let pending: PendingNext | undefined;
    let endResponse: (() => void) | undefined;

    // Abort the SDK watch first, then let the generator unwind on its own.
    // Awaiting `return()` while a `next()` is pending would wait for the
    // event that never comes.
    const finish = (): void => {
      request.signal.removeEventListener("abort", finish);
      if (!watches.delete(finish)) return;
      watchController.abort();
      firstRead.resolve({ done: true, value: undefined });
      pending?.stop();
      endResponse?.();
      void iterator.return?.().catch(() => undefined);
    };
    watches.add(finish);
    request.signal.addEventListener("abort", finish, { once: true });
    if (request.signal.aborted) finish();

    // The first pull happens before any header is written: a cursor below
    // the floor or an unknown session is a JSON error with a status, not a
    // stream that fails on its first frame.
    let first: IteratorResult<SessionEvent>;
    try {
      if (!signal.aborted) void iterator.next().then(firstRead.resolve, firstRead.reject);
      first = await firstRead.promise;
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
    if (closed) {
      return refuse({ code: "closed", message: "The server is closed" }, cors);
    }

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
        endResponse = () => end(controller, closed ? closedFrame : { kind: "ended" });
        if (first.done) {
          end(controller, closed ? closedFrame : { kind: "ended" });
          return;
        }
        emit(controller, first.value);
      },
      async pull(controller) {
        if (ended) return;
        let result: IteratorResult<SessionEvent> | undefined;
        try {
          pending ??= new PendingNext(iterator.next());
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
        if (result.done) {
          end(controller, closed ? closedFrame : { kind: "ended" });
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

    if (closed) return refuse({ code: "closed", message: "The server is closed" }, cors);

    if (url.pathname === INFO_ROUTE) {
      if (request.method !== "GET") {
        return refuse({ code: "method_not_allowed", message: "Info is GET" }, cors);
      }
      const description = await options.describe?.();
      if (description !== undefined && !Value.Check(ServerDescriptionSchema, description)) {
        throw new TypeError("Invalid server description");
      }
      if (closed) return refuse({ code: "closed", message: "The server is closed" }, cors);
      const info: ServerInfo = {
        version: options.version,
        wireVersion: WIRE_VERSION,
        host:
          description === undefined
            ? { kind: "unspecified" }
            : { kind: "described", ...description },
      };
      return jsonResponse(200, { ok: true, defined: true, value: info }, cors);
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
      const operation = parseOperation(name);
      if (operation === undefined) {
        return refuse({ code: "unknown_operation", message: `Unknown operation: ${name}` }, cors);
      }
      return call(request, operation, cors);
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
      for (const finish of watches) finish();
    },
  };
}
