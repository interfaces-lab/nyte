/**
 * The Codex WebSocket transport: per-session connection reuse, frame decoding, and continuing
 * a cached connection's last response with `previous_response_id` and only the new input.
 */
import { Value } from "typebox/value";
import { registerSessionResourceCleanup } from "../session-resources.ts";
import type { AssistantMessage, ProviderEnv } from "../types.ts";
import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
  formatThrownValue,
} from "../utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { FifoQueue } from "../utils/fifo-queue.ts";
import { headersToRecord } from "../utils/headers.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { normalizeContext } from "../utils/transcript.ts";
import {
  CODEX_TOOL_CALL_PROVIDERS,
  CodexApiError,
  CodexProtocolError,
  type CodexRequest,
  codexStreamOptions,
  mapCodexEvents,
  type RequestBody,
} from "./openai-codex-protocol.ts";
import {
  CodexFrameJson,
  type CodexFrame,
  readBoolean,
  readNumber,
  readRecord,
  readText,
  resolveCodexWebSocketUrl,
  TERMINAL_RESPONSE_TYPES,
} from "./openai-codex-wire.ts";
import { convertResponsesMessages, type ResponsesInput } from "./openai-responses-convert.ts";
import { processResponsesStream, ResponsesUsageError } from "./openai-responses-stream.ts";

const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;

const WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;

const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";

const PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found";

const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;

const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;

/** The WHATWG `readyState` of an open socket. */
const WEBSOCKET_OPEN = 1;

/** Structural views of the DOM-shaped events runtimes dispatch on sockets. */
interface WebSocketMessageEvent {
  readonly data?: unknown;
}

interface WebSocketErrorEvent {
  readonly message?: unknown;
  readonly error?: unknown;
}

interface WebSocketCloseEvent {
  readonly code?: unknown;
  readonly reason?: unknown;
  readonly wasClean?: unknown;
}

type WebSocketMessageListener = (event: WebSocketMessageEvent) => void;

type WebSocketErrorListener = (event: WebSocketErrorEvent) => void;

type WebSocketCloseListener = (event: WebSocketCloseEvent) => void;

interface WebSocketLike {
  /** Numeric ready state per the WHATWG spec; absent on exotic runtimes. */
  readonly readyState?: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: WebSocketMessageListener): void;
  addEventListener(type: "error", listener: WebSocketErrorListener): void;
  addEventListener(type: "close", listener: WebSocketCloseListener): void;
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: WebSocketMessageListener): void;
  removeEventListener(type: "error", listener: WebSocketErrorListener): void;
  removeEventListener(type: "close", listener: WebSocketCloseListener): void;
}

/** The connection's last request and response, which the next request may continue. */
interface CachedWebSocketContinuationState {
  lastRequestBody: RequestBody;
  lastResponseId: string;
  lastResponseItems: ResponsesInput;
}

interface CachedWebSocketConnection {
  socket: WebSocketLike;
  busy: boolean;
  createdAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  continuation?: CachedWebSocketContinuationState;
}

interface AcquiredWebSocket {
  socket: WebSocketLike;
  entry?: CachedWebSocketConnection;
  release: (keep: boolean) => void;
}

/** Cached connections by session id, then account id. */
const websocketSessionCache = new Map<string, Map<string, CachedWebSocketConnection>>();

/** Sessions whose WebSocket failed; they stay on SSE until their resources are cleaned up. */
const websocketSseFallbackSessions = new Set<string>();

/** Closes the cached sockets of `sessionId`, or of every session, and forgets their SSE fallback. */
export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
  const closeEntry = (entry: CachedWebSocketConnection) => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    closeWebSocketSilently(entry.socket, 1000, "debug_close");
  };

  if (sessionId) {
    for (const entry of websocketSessionCache.get(sessionId)?.values() ?? []) closeEntry(entry);
    websocketSessionCache.delete(sessionId);
    websocketSseFallbackSessions.delete(sessionId);

    return;
  }

  for (const accountEntries of websocketSessionCache.values()) {
    for (const entry of accountEntries.values()) closeEntry(entry);
  }

  websocketSessionCache.clear();
  websocketSseFallbackSessions.clear();
}

registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);

class WebSocketCloseError extends Error {
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;

  constructor(message: string, options?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(message);
    this.name = "WebSocketCloseError";
    this.code = options?.code;
    this.reason = options?.reason;
    this.wasClean = options?.wasClean;
  }
}

function codexErrorCode(cause: unknown): string | undefined {
  return cause instanceof CodexApiError ? cause.code : undefined;
}

/** A socket without `readyState` is assumed to stay open, as some runtimes omit it. */
function socketReusable(socket: WebSocketLike): boolean {
  return socket.readyState === undefined || socket.readyState === WEBSOCKET_OPEN;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
  try {
    socket.close(code, reason);
  } catch {
    return;
  }
}

function forgetEntry(sessionId: string, accountId: string, entry: CachedWebSocketConnection): void {
  const accountEntries = websocketSessionCache.get(sessionId);

  if (accountEntries?.get(accountId) === entry) accountEntries.delete(accountId);

  if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
}

function scheduleSessionWebSocketExpiry(
  sessionId: string,
  accountId: string,
  entry: CachedWebSocketConnection,
): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }

  entry.idleTimer = setTimeout(() => {
    if (entry.busy) return;
    closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
    forgetEntry(sessionId, accountId, entry);
  }, SESSION_WEBSOCKET_CACHE_TTL_MS);
  entry.idleTimer.unref?.();
}

/**
 * A socket on the runtime's `WebSocket`, which browsers, Node and Bun all expose. Node and Bun
 * take an init object with `headers`, and Bun also honors an undici-style `proxy`, which carries
 * the provider's HTTP proxy. The DOM typing of the constructor admits only protocols as its second
 * argument, and which typing applies depends on the consumer's lib, so it is constructed through
 * `Reflect.construct` against the structural {@link WebSocketLike} it is used as.
 */
function openWebSocket(
  url: string,
  headers: Record<string, string>,
  env: ProviderEnv | undefined,
): WebSocketLike {
  const WebSocketClass: unknown = globalThis.WebSocket;

  if (typeof WebSocketClass !== "function") {
    throw new Error("WebSocket transport is not available in this runtime");
  }

  const init: { headers: Record<string, string>; proxy?: string } = { headers };

  if (typeof process !== "undefined" && process.versions?.bun) {
    const proxyUrl = resolveHttpProxyUrlForTarget(
      url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
      env,
    );

    if (proxyUrl) init.proxy = proxyUrl.href;
  }

  const socket: WebSocketLike = Reflect.construct(WebSocketClass, [url, init]);

  return socket;
}

async function connectWebSocket(
  url: string,
  headers: Headers,
  signal?: AbortSignal,
  connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS,
  env?: ProviderEnv,
): Promise<WebSocketLike> {
  const wsHeaders = headersToRecord(headers);
  delete wsHeaders["OpenAI-Beta"];
  const socket = openWebSocket(url, wsHeaders, env);

  return new Promise<WebSocketLike>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }

      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error, closeReason?: string) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (closeReason) {
        closeWebSocketSilently(socket, 1000, closeReason);
      }

      reject(error);
    };

    const onOpen: () => void = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };

    const onError: WebSocketErrorListener = (event) => {
      fail(extractWebSocketError(event));
    };

    const onClose: WebSocketCloseListener = (event) => {
      fail(extractWebSocketCloseError(event));
    };

    const onAbort = () => {
      fail(new Error("Request was aborted"), "aborted");
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort);

    if (connectTimeoutMs > 0) {
      timeout = setTimeout(() => {
        fail(new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`), "connect_timeout");
      }, connectTimeoutMs);
    }

    if (signal?.aborted) {
      onAbort();
    }
  });
}

/** Releasing keeps the entry cached for reuse only when asked to and the socket is still open. */
function cachedEntryRelease(
  sessionId: string,
  accountId: string,
  entry: CachedWebSocketConnection,
): (keep: boolean) => void {
  return (keep) => {
    if (!keep || !socketReusable(entry.socket)) {
      closeWebSocketSilently(entry.socket);

      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      forgetEntry(sessionId, accountId, entry);

      return;
    }

    entry.busy = false;
    scheduleSessionWebSocketExpiry(sessionId, accountId, entry);
  };
}

/**
 * A socket for one request. Without a session it is single-use. With one, an idle open cached
 * socket younger than the age limit is reused; a busy one gets a single-use socket beside it;
 * otherwise a new socket replaces the cached entry.
 */
async function acquireWebSocket(
  url: string,
  headers: Headers,
  sessionId: string | undefined,
  accountId: string,
  signal?: AbortSignal,
  connectTimeoutMs?: number,
  env?: ProviderEnv,
): Promise<AcquiredWebSocket> {
  const connectSingleUse = async (): Promise<AcquiredWebSocket> => {
    const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);

    return { socket, release: () => closeWebSocketSilently(socket) };
  };

  if (!sessionId) return connectSingleUse();

  const cached = websocketSessionCache.get(sessionId)?.get(accountId);

  if (cached) {
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = undefined;
    }

    if (cached.busy) return connectSingleUse();

    if (Date.now() - cached.createdAt >= SESSION_WEBSOCKET_MAX_AGE_MS) {
      closeWebSocketSilently(cached.socket, 1000, "connection_age_limit");
      forgetEntry(sessionId, accountId, cached);
    } else if (socketReusable(cached.socket)) {
      cached.busy = true;

      return {
        socket: cached.socket,
        entry: cached,
        release: cachedEntryRelease(sessionId, accountId, cached),
      };
    } else {
      closeWebSocketSilently(cached.socket);
      forgetEntry(sessionId, accountId, cached);
    }
  }

  const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
  const entry: CachedWebSocketConnection = { socket, busy: true, createdAt: Date.now() };
  let accountEntries = websocketSessionCache.get(sessionId);

  if (!accountEntries) {
    accountEntries = new Map();
    websocketSessionCache.set(sessionId, accountEntries);
  }

  accountEntries.set(accountId, entry);

  return { socket, entry, release: cachedEntryRelease(sessionId, accountId, entry) };
}

function extractWebSocketError(event: WebSocketErrorEvent): Error {
  const message = readText(event.message);

  if (message) return new Error(message);

  const nested = event.error;

  if (nested instanceof Error && nested.message.length > 0) return nested;
  const nestedMessage = readText(readRecord(nested)?.message);

  if (nestedMessage) return new Error(nestedMessage);

  return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: WebSocketCloseEvent): Error {
  const code = readNumber(event.code);
  const reason = readText(event.reason);
  const codeText = code !== undefined ? ` ${code}` : "";

  const reasonText =
    reason && reason.length > 0
      ? ` ${reason}`
      : code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE
        ? " message too big"
        : "";

  return new WebSocketCloseError(`WebSocket closed${codeText}${reasonText}`.trim(), {
    code,
    reason,
    wasClean: readBoolean(event.wasClean),
  });
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
  const text = readText(data);

  if (text !== undefined) return text;

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  const blobLike = readRecord(data);

  if (blobLike && blobLike.arrayBuffer instanceof Function) {
    const arrayBuffer = await blobLike.arrayBuffer();

    return new TextDecoder().decode(new Uint8Array(arrayBuffer));
  }

  return null;
}

/**
 * Socket events queue before message data is decoded: Blob decoding is asynchronous, so
 * decoding inside the message listener would let a following close overtake the terminal frame.
 */
type QueuedWebSocketEvent = { kind: "message"; data: unknown } | { kind: "failure"; error: Error };

async function* parseWebSocket(
  socket: WebSocketLike,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<CodexFrame> {
  const queue = new FifoQueue<QueuedWebSocketEvent>();
  let pending: (() => void) | null = null;

  const wake = () => {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    resolve();
  };

  const enqueue = (event: QueuedWebSocketEvent) => {
    queue.enqueue(event);
    wake();
  };

  const onMessage: WebSocketMessageListener = (event) => {
    enqueue({ kind: "message", data: event.data });
  };

  const onError: WebSocketErrorListener = (event) => {
    enqueue({ kind: "failure", error: extractWebSocketError(event) });
  };

  const onClose: WebSocketCloseListener = (event) => {
    enqueue({ kind: "failure", error: extractWebSocketCloseError(event) });
  };

  const onAbort = () => {
    enqueue({ kind: "failure", error: new Error("Request was aborted") });
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (queue.length === 0) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve, reject) => {
          pending = resolve;

          if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
            timeout = setTimeout(() => {
              const error = new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
              pending = null;
              closeWebSocketSilently(socket, 1000, "idle_timeout");
              reject(error);
            }, idleTimeoutMs);
          }
        }).finally(() => {
          if (timeout) {
            clearTimeout(timeout);
          }
        });
      }

      const event = queue.dequeue();

      if (!event) continue;

      if (event.kind === "failure") {
        throw event.error;
      }

      let text: string | null = null;
      let frame: CodexFrame | undefined;

      try {
        text = await decodeWebSocketData(event.data);

        const decoded: unknown = text ? JSON.parse(text) : undefined;

        if (Value.Check(CodexFrameJson, decoded)) frame = decoded;
      } catch (cause) {
        throw new CodexProtocolError(`Invalid Codex WebSocket JSON: ${formatThrownValue(cause)}`, {
          cause,
          payload: text,
        });
      }

      if (!frame) continue;
      const terminal = TERMINAL_RESPONSE_TYPES.has(frame.type);
      yield frame;

      if (terminal) return;
    }
  } finally {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  }
}

function requestBodyWithoutInput(body: RequestBody): RequestBody {
  const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;

  return rest;
}

/**
 * The input this request adds to the connection's last request and response, when everything
 * else in the body matches and the input extends that baseline.
 */
function getCachedWebSocketInputDelta(
  body: RequestBody,
  continuation: CachedWebSocketContinuationState,
): ResponsesInput | undefined {
  if (
    JSON.stringify(requestBodyWithoutInput(body)) !==
    JSON.stringify(requestBodyWithoutInput(continuation.lastRequestBody))
  ) {
    return undefined;
  }

  const currentInput = body.input ?? [];

  const baseline = [
    ...(continuation.lastRequestBody.input ?? []),
    ...continuation.lastResponseItems,
  ];

  if (currentInput.length < baseline.length) {
    return undefined;
  }

  if (JSON.stringify(currentInput.slice(0, baseline.length)) !== JSON.stringify(baseline)) {
    return undefined;
  }

  return currentInput.slice(baseline.length);
}

function buildCachedWebSocketRequestBody(
  entry: CachedWebSocketConnection,
  body: RequestBody,
): RequestBody {
  const continuation = entry.continuation;

  if (!continuation) {
    return body;
  }

  const delta = getCachedWebSocketInputDelta(body, continuation);

  if (!delta || !continuation.lastResponseId) {
    entry.continuation = undefined;

    return body;
  }

  return {
    ...body,
    previous_response_id: continuation.lastResponseId,
    input: delta,
  };
}

/**
 * Frames that never start the assistant output: rate-limit telemetry, error frames, and a
 * failed terminal frame, which is processed only to account for usage and must not turn a
 * before-start API failure into an after-start transport failure.
 */
const NON_STARTING_FRAMES: ReadonlySet<string> = new Set([
  "codex.rate_limits",
  "error",
  "response.failed",
]);

/** Calls `onStart` before the first frame that produces assistant output. */
async function* startWebSocketOutputOnFirstEvent(
  frames: AsyncIterable<CodexFrame>,
  onStart: () => void,
): AsyncGenerator<CodexFrame> {
  let started = false;

  for await (const frame of frames) {
    if (!started && !NON_STARTING_FRAMES.has(frame.type)) {
      started = true;
      onStart();
    }

    yield frame;
  }
}

/**
 * Sends one request on an acquired socket and streams its response into `output`. ChatGPT
 * Codex rejects `store: true`, so continuation works through the connection-scoped
 * `previous_response_id` state, which a cached-context transport records after each response.
 */
async function processWebSocketStream(
  request: CodexRequest,
  headers: Headers,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  onStart: () => void,
): Promise<void> {
  const { model, options } = request;
  const { socket, entry, release } = await acquireWebSocket(
    resolveCodexWebSocketUrl(model.baseUrl),
    headers,
    request.cacheSessionId,
    request.accountId,
    options?.signal,
    request.connectTimeoutMs,
    options?.env,
  );

  let keepConnection = true;

  const useCachedContext =
    options?.transport === "websocket-cached" || options?.transport === "auto";

  const requestBody =
    useCachedContext && entry ? buildCachedWebSocketRequestBody(entry, request.body) : request.body;

  try {
    socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
    await processResponsesStream(
      mapCodexEvents(
        startWebSocketOutputOnFirstEvent(
          parseWebSocket(socket, options?.signal, request.timeoutMs),
          onStart,
        ),
        output,
        options?.onAccountLimits === undefined
          ? undefined
          : (limits) => options.onAccountLimits?.(limits, model),
      ),
      output,
      stream,
      model,
      codexStreamOptions(request),
    );

    if (options?.signal?.aborted) {
      keepConnection = false;
    } else if (useCachedContext && entry && output.responseId) {
      const responseItems = convertResponsesMessages(
        model,
        normalizeContext({ messages: [output] }),
        CODEX_TOOL_CALL_PROVIDERS,
        {
          includeSystemPrompt: false,
          grammarToolInputProperties: request.grammarToolInputProperties,
        },
      ).filter(
        (item) => item.type !== "function_call_output" && item.type !== "custom_tool_call_output",
      );

      entry.continuation = {
        lastRequestBody: request.body,
        lastResponseId: output.responseId,
        lastResponseItems: responseItems,
      };
    }
  } catch (error) {
    if (entry) {
      entry.continuation = undefined;
    }

    keepConnection = false;
    throw error;
  } finally {
    release(keepConnection);
  }
}

/**
 * Streams `request` over a Codex WebSocket into `output`, pushing `start` on the first event.
 * One retry each covers a missing continuation and a connection limit hit before any event.
 * A transport failure before any event records a diagnostic, moves the session onto SSE and
 * returns false so the caller sends the request over SSE; protocol and API failures, and any
 * failure after the first event, throw.
 */
export async function streamOverWebSocket(
  request: CodexRequest,
  headers: Headers,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
): Promise<boolean> {
  const { options, cacheSessionId } = request;
  const transport = options?.transport || "auto";

  if (
    transport === "sse" ||
    (cacheSessionId !== undefined && websocketSseFallbackSessions.has(cacheSessionId))
  ) {
    return false;
  }

  let startEmitted = false;
  let retriedWebSocketConnectionLimit = false;
  let retriedMissingWebSocketContinuation = false;

  for (;;) {
    let websocketStarted = false;

    try {
      await processWebSocketStream(request, headers, output, stream, () => {
        websocketStarted = true;

        if (!startEmitted) {
          startEmitted = true;
          stream.push({ type: "start", partial: output });
        }
      });

      return true;
    } catch (error) {
      const aborted = options?.signal?.aborted;
      const code = codexErrorCode(error);
      const connectionLimitBeforeStart =
        !websocketStarted && code === WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE;

      if (
        !aborted &&
        code === PREVIOUS_RESPONSE_NOT_FOUND_CODE &&
        !retriedMissingWebSocketContinuation
      ) {
        retriedMissingWebSocketContinuation = true;
        continue;
      }

      if (!aborted && connectionLimitBeforeStart && !retriedWebSocketConnectionLimit) {
        retriedWebSocketConnectionLimit = true;
        continue;
      }

      const failedInProtocol =
        error instanceof CodexApiError ||
        error instanceof CodexProtocolError ||
        error instanceof ResponsesUsageError;

      if (aborted || (failedInProtocol && !connectionLimitBeforeStart)) {
        throw error;
      }

      appendAssistantMessageDiagnostic(
        output,
        createAssistantMessageDiagnostic("provider_transport_failure", error, {
          configuredTransport: transport,
          fallbackTransport: websocketStarted ? undefined : "sse",
          eventsEmitted: websocketStarted,
          phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
          requestBytes: new TextEncoder().encode(JSON.stringify(request.body)).byteLength,
        }),
      );

      if (cacheSessionId) websocketSseFallbackSessions.add(cacheSessionId);

      if (websocketStarted) {
        throw error;
      }

      return false;
    }
  }
}
