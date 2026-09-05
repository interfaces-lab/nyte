/**
 * `@nyte-ai/client`: the SDK namespaces over `fetch`. Each verb is one
 * `POST /v1/call/{verb}` whose reply is checked against the verb's output
 * schema before it is returned; `watch` is `GET /v1/watch` read as
 * server-sent events and yielded as an `AsyncIterable<SessionEvent>`.
 *
 * Nothing here retries. A call that fails throws; a watch that ends without
 * the server's `ended` frame throws. The caller decides what to do next,
 * usually `sessions.snapshot` followed by a watch from the snapshot's `seq`.
 *
 * Depends on `@nyte-ai/protocol` only: no core, no Node. Runs wherever
 * `fetch`, `Headers`, `ReadableStream`, and `TextDecoder` exist.
 */
import {
  CALL_ROUTE_PREFIX,
  CallReplySchema,
  EVENT_STREAM_MEDIA_TYPE,
  JSON_MEDIA_TYPE,
  VERBS,
  WATCH_QUERY,
  WATCH_ROUTE,
  WatchEndedSchema,
  WireErrorSchema,
  createSseParser,
  decode,
  describeIssues,
  isWatchFrameKind,
  schemas,
  type Issue,
  type RemoteNyte,
  type RemoteWatchInput,
  type SessionEvent,
  type Verb,
  type VerbInput,
  type VerbOutput,
  type WireError,
} from "@nyte-ai/protocol";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The server answered, and the answer was an error. `code` is stable; match on it. */
export class NyteWireError extends Error {
  readonly error: WireError;
  /** The HTTP status that carried the error, or undefined when it came as a stream frame. */
  readonly status: number | undefined;

  constructor(error: WireError, status?: number) {
    super(error.message);
    this.name = "NyteWireError";
    this.error = error;
    this.status = status;
  }

  get code(): WireError["code"] {
    return this.error.code;
  }
}

export type TransportFailure =
  /** `fetch` itself rejected: DNS, refused connection, redirect. */
  | { readonly kind: "network"; readonly cause: unknown }
  /** A status the protocol does not produce, with no error envelope to explain it. */
  | { readonly kind: "bad_status"; readonly status: number }
  | {
      readonly kind: "bad_content_type";
      readonly status: number;
      readonly contentType: string | undefined;
    }
  /** The body was not the envelope, or the value did not match the verb's output schema. */
  | { readonly kind: "bad_body"; readonly detail: string; readonly issues: readonly Issue[] }
  /** The watch stream ended without an `ended` or `error` frame. */
  | { readonly kind: "disconnected" };

/** The exchange did not complete as the protocol describes. Nothing about the SDK can be concluded. */
export class NyteTransportError extends Error {
  readonly failure: TransportFailure;

  constructor(failure: TransportFailure) {
    super(describeFailure(failure));
    this.name = "NyteTransportError";
    this.failure = failure;
    if (failure.kind === "network") this.cause = failure.cause;
  }
}

function describeFailure(failure: TransportFailure): string {
  switch (failure.kind) {
    case "network":
      return "The request could not be sent";
    case "bad_status":
      return `Unexpected HTTP status ${String(failure.status)}`;
    case "bad_content_type":
      return `Unexpected content type ${failure.contentType ?? "(none)"} with status ${String(failure.status)}`;
    case "bad_body":
      return failure.detail;
    case "disconnected":
      return "The watch stream was interrupted";
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface NyteClientOptions {
  /** Where the server's `/v1` routes hang, e.g. `http://127.0.0.1:8787`. A path prefix is kept. */
  readonly baseUrl: string;
  /** Sent as `Authorization: Bearer <token>`. */
  readonly token?: string;
  /** Extra headers on every request. `content-type`, `accept`, and `authorization` are set by the client. */
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  /** Defaults to the global `fetch`. A test can pass a server handler here. */
  readonly fetch?: typeof fetch;
  /**
   * The most one watch frame may hold, in UTF-16 code units of the decoded
   * text. A larger frame ends the watch with a `bad_body` transport failure.
   * Default 4 194 304.
   */
  readonly maxFrameChars?: number;
}

export type NyteClient = RemoteNyte;

function mediaType(header: string | null): string | undefined {
  if (header === null) return undefined;
  const semicolon = header.indexOf(";");
  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

export function createNyteClient(options: NyteClientOptions): NyteClient {
  const base = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const fetchFn = options.fetch ?? globalThis.fetch;

  const headersFor = (accept: string): Headers => {
    const headers = new Headers(options.headers);
    headers.set("accept", accept);
    if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);
    return headers;
  };

  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchFn(url, { ...init, redirect: "error" });
    } catch (cause) {
      throw new NyteTransportError({ kind: "network", cause });
    }
  };

  /** Read a JSON error envelope from a refused response, or explain why there was none. */
  const refusal = async (response: Response): Promise<NyteWireError | NyteTransportError> => {
    const type = mediaType(response.headers.get("content-type"));
    if (type !== JSON_MEDIA_TYPE) {
      void response.body?.cancel().catch(() => undefined);
      return new NyteTransportError({
        kind: "bad_content_type",
        status: response.status,
        contentType: type,
      });
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return new NyteTransportError({
        kind: "bad_body",
        detail: "Reply is not valid JSON",
        issues: [],
      });
    }
    const reply = decode(CallReplySchema, parsed);
    if (!reply.ok) {
      return new NyteTransportError({
        kind: "bad_body",
        detail: `Reply is not a call envelope: ${describeIssues(reply.issues)}`,
        issues: reply.issues,
      });
    }
    if (!reply.value.ok) return new NyteWireError(reply.value.error, response.status);
    return new NyteTransportError({ kind: "bad_status", status: response.status });
  };

  /** `input` is optional here for verbs that take none; `RemoteNyte` requires it where the verb does. */
  async function call<V extends Verb>(
    verb: V,
    input: VerbInput<V> | undefined,
  ): Promise<VerbOutput<V>> {
    const headers = headersFor(JSON_MEDIA_TYPE);
    headers.set("content-type", JSON_MEDIA_TYPE);
    const response = await send(`${base}${CALL_ROUTE_PREFIX}${verb}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input === undefined ? {} : { input }),
    });
    if (!response.ok || mediaType(response.headers.get("content-type")) !== JSON_MEDIA_TYPE) {
      throw await refusal(response);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new NyteTransportError({
        kind: "bad_body",
        detail: "Reply is not valid JSON",
        issues: [],
      });
    }
    const reply = decode(CallReplySchema, parsed);
    if (!reply.ok) {
      throw new NyteTransportError({
        kind: "bad_body",
        detail: `Reply is not a call envelope: ${describeIssues(reply.issues)}`,
        issues: reply.issues,
      });
    }
    if (!reply.value.ok) throw new NyteWireError(reply.value.error, response.status);
    const value = reply.value.defined ? reply.value.value : undefined;
    const output = decode<(typeof VERBS)[V]["output"]>(VERBS[verb].output, value);
    if (!output.ok) {
      throw new NyteTransportError({
        kind: "bad_body",
        detail: `Reply to ${verb} did not match its schema: ${describeIssues(output.issues)}`,
        issues: output.issues,
      });
    }
    return output.value;
  }

  const verb =
    <V extends Verb>(name: V) =>
    (input?: VerbInput<V>): Promise<VerbOutput<V>> =>
      call(name, input);

  const watch = (input: RemoteWatchInput): AsyncIterable<SessionEvent> => ({
    [Symbol.asyncIterator]: () =>
      createWatchIterator({
        input,
        maxFrameChars: options.maxFrameChars,
        open: () => {
          const params = new URLSearchParams();
          params.set(WATCH_QUERY.sessionId, input.sessionId);
          if ("live" in input) params.set(WATCH_QUERY.live, "1");
          else if (input.afterSeq !== undefined)
            params.set(WATCH_QUERY.after, String(input.afterSeq));
          return {
            url: `${base}${WATCH_ROUTE}?${params.toString()}`,
            headers: headersFor(EVENT_STREAM_MEDIA_TYPE),
          };
        },
        send,
        refusal,
      }),
  });

  return {
    landing: verb("landing"),
    sessions: {
      create: verb("sessions.create"),
      get: verb("sessions.get"),
      snapshot: verb("sessions.snapshot"),
      list: verb("sessions.list"),
      rename: verb("sessions.rename"),
      setPinned: verb("sessions.setPinned"),
      setArchived: verb("sessions.setArchived"),
      delete: verb("sessions.delete"),
      configure: verb("sessions.configure"),
    },
    messages: {
      send: verb("messages.send"),
      cancel: verb("messages.cancel"),
      redeliver: verb("messages.redeliver"),
    },
    runs: {
      abort: verb("runs.abort"),
      changes: verb("runs.changes"),
    },
    heads: {
      move: verb("heads.move"),
    },
    workspace: {
      list: verb("workspace.list"),
      forget: verb("workspace.forget"),
      vcs: { diff: verb("workspace.vcs.diff") },
    },
    provider: {
      models: { default: verb("provider.models.default") },
    },
    plugins: {
      catalog: verb("plugins.catalog"),
      list: verb("plugins.list"),
      commands: {
        list: verb("plugins.commands.list"),
        run: verb("plugins.commands.run"),
      },
      settings: {
        list: verb("plugins.settings.list"),
        apply: verb("plugins.settings.apply"),
      },
      resources: { list: verb("plugins.resources.list") },
    },
    watch,
  };
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

interface WatchIteratorDependencies {
  readonly input: RemoteWatchInput;
  readonly maxFrameChars: number | undefined;
  readonly open: () => { readonly url: string; readonly headers: Headers };
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
  readonly refusal: (response: Response) => Promise<NyteWireError | NyteTransportError>;
}

type Outcome =
  | { readonly kind: "ended" }
  | { readonly kind: "failed"; readonly error: NyteWireError | NyteTransportError };

function badFrame(detail: string, issues: readonly Issue[] = []): NyteTransportError {
  return new NyteTransportError({ kind: "bad_body", detail, issues });
}

function asTransportError(cause: unknown): NyteWireError | NyteTransportError {
  if (cause instanceof NyteWireError || cause instanceof NyteTransportError) return cause;
  return new NyteTransportError({ kind: "network", cause });
}

const DONE: IteratorResult<SessionEvent> = { done: true, value: undefined };

/**
 * A hand-written iterator rather than a generator so `return()` takes effect
 * at once: it aborts the request and cancels the body even while a `next()`
 * is waiting on the network, and that waiting `next()` then resolves done.
 * Every terminal path, the server's `ended`, an error frame, end of stream,
 * a malformed frame, a failed open, or the caller's own stop, releases the
 * body and the abort listener through the one `finish`.
 */
function createWatchIterator(dependencies: WatchIteratorDependencies): AsyncIterator<SessionEvent> {
  const controller = new AbortController();
  const parser = createSseParser(
    dependencies.maxFrameChars === undefined ? {} : { maxFrameChars: dependencies.maxFrameChars },
  );
  let queue: SessionEvent[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let outcome: Outcome | undefined;
  /** The caller stopped the watch; nothing after that is a failure. */
  let cancelled = false;
  /** Resources are released; no more reads happen. */
  let finished = false;
  let reported = false;
  let opened = false;
  let busy: Promise<IteratorResult<SessionEvent>> = Promise.resolve(DONE);
  const { signal } = dependencies.input;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    queue = [];
    signal?.removeEventListener("abort", cancel);
    controller.abort();
    const current = reader;
    reader = undefined;
    void current?.cancel().catch(() => undefined);
  };

  function cancel(): void {
    cancelled = true;
    finish();
  }

  if (signal?.aborted === true) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });

  const fail = (error: NyteWireError | NyteTransportError): void => {
    outcome = { kind: "failed", error };
  };

  const settle = (frameKind: string, data: string): void => {
    if (!isWatchFrameKind(frameKind)) {
      fail(badFrame(`Unknown watch frame: ${frameKind}`));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      fail(badFrame(`Watch frame ${frameKind} is not valid JSON`));
      return;
    }
    switch (frameKind) {
      case "event": {
        const event = decode(schemas.SessionEvent, parsed);
        if (event.ok) queue.push(event.value);
        else {
          fail(
            badFrame(
              `Watch event did not match its schema: ${describeIssues(event.issues)}`,
              event.issues,
            ),
          );
        }
        return;
      }
      case "ended": {
        const ended = decode(WatchEndedSchema, parsed);
        if (ended.ok) outcome = { kind: "ended" };
        else fail(badFrame(`Watch ended frame is malformed: ${describeIssues(ended.issues)}`));
        return;
      }
      case "error": {
        const error = decode(WireErrorSchema, parsed);
        fail(
          error.ok
            ? new NyteWireError(error.value)
            : badFrame(
                `Watch error frame is malformed: ${describeIssues(error.issues)}`,
                error.issues,
              ),
        );
        return;
      }
      default: {
        const _exhaustive: never = frameKind;
        return _exhaustive;
      }
    }
  };

  const open = async (): Promise<void> => {
    opened = true;
    const target = dependencies.open();
    const response = await dependencies.send(target.url, {
      method: "GET",
      headers: target.headers,
      signal: controller.signal,
    });
    if (finished) {
      // The caller stopped while the request was in flight; the body is not ours to read.
      void response.body?.cancel().catch(() => undefined);
      return;
    }
    const type = mediaType(response.headers.get("content-type"));
    if (response.status !== 200 || type !== EVENT_STREAM_MEDIA_TYPE) {
      throw await dependencies.refusal(response);
    }
    if (response.body === null) throw new NyteTransportError({ kind: "disconnected" });
    reader = response.body.getReader();
  };

  const pump = async (): Promise<void> => {
    const current = reader;
    if (current === undefined) throw new NyteTransportError({ kind: "disconnected" });
    const { done, value } = await current.read();
    if (finished) return;
    const frames = done ? parser.end() : parser.feed(value);
    for (const frame of frames) {
      if (outcome !== undefined) break;
      settle(frame.event ?? "", frame.data);
    }
    if (outcome !== undefined) return;
    if (parser.overflow !== undefined) fail(badFrame(parser.overflow.message));
    else if (done) fail(new NyteTransportError({ kind: "disconnected" }));
  };

  const terminal = (): IteratorResult<SessionEvent> => {
    finish();
    if (!cancelled && outcome?.kind === "failed" && !reported) {
      reported = true;
      throw outcome.error;
    }
    return DONE;
  };

  const advance = async (): Promise<IteratorResult<SessionEvent>> => {
    for (;;) {
      if (finished) return terminal();
      const event = queue.shift();
      if (event !== undefined) return { done: false, value: event };
      if (outcome !== undefined) return terminal();
      try {
        if (!opened) await open();
        else await pump();
      } catch (cause) {
        if (!finished) fail(asTransportError(cause));
        return terminal();
      }
    }
  };

  return {
    next() {
      const result = busy.then(advance, advance);
      busy = result.catch(() => DONE);
      return result;
    },
    return() {
      cancel();
      return Promise.resolve(DONE);
    },
    throw(cause: unknown) {
      cancel();
      return Promise.reject(cause);
    },
  };
}
