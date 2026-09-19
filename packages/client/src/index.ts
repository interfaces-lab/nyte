/**
 * `@nyte-ai/client`: everything a client needs at any runtime: the fetch
 * transport, the session fold and observer, and the projections.
 *
 * The transport is the SDK namespaces over `fetch`. Each operation is one
 * `POST /v1/call/{operation}` whose reply is checked against the operation's output
 * schema before it is returned; `watch` is `GET /v1/watch` read as
 * server-sent events and yielded as an `AsyncIterable<SessionEvent>`; `info`
 * is `GET /v1/info`. A server on another wire version answers that route with
 * `not_found`, because the wire version is the route prefix.
 *
 * Nothing here retries. A call that fails throws; a watch that ends without
 * the server's `ended` frame throws. The caller decides what to do next,
 * usually `sessions.snapshot` followed by a watch from the snapshot's `seq`.
 *
 * Depends on `@nyte-ai/protocol` and `typebox`: no Node. Runs wherever
 * `fetch`, `Headers`, `ReadableStream`, and `TextDecoder` exist.
 */
import {
  CALL_ROUTE_PREFIX,
  CallReplySchema,
  EVENT_STREAM_MEDIA_TYPE,
  INFO_ROUTE,
  JSON_MEDIA_TYPE,
  OPERATIONS,
  ServerInfoSchema,
  WATCH_QUERY,
  WATCH_ROUTE,
  WatchEndedSchema,
  WatchFrameKindSchema,
  WireErrorSchema,
  createSseParser,
  describeIssues,
  mediaType,
  schemas,
  validationIssues,
  type CallReply,
  type Issue,
  type RemoteNyte,
  type RemoteWatchInput,
  type SessionEvent,
  type Operation,
  type OperationInput,
  type OperationOutput,
  type ServerInfo,
  type WireError,
} from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";

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
  /** The body was not the envelope, or the value did not match the operation's output schema. */
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
  readonly fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
  /**
   * Maximum decoded UTF-16 code units per watch frame, including field names,
   * comments and line endings. A larger frame ends the watch with `bad_body`.
   * Default 4 194 304.
   */
  readonly maxFrameChars?: number;
}

export type NyteClient = RemoteNyte & {
  /** What is answering: the host's release and the wire version this client already speaks. */
  info(): Promise<ServerInfo>;
};

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

  const readReply = async (response: Response): Promise<CallReply> => {
    const type = mediaType(response.headers.get("content-type"));
    if (type !== JSON_MEDIA_TYPE) {
      void response.body?.cancel().catch(() => undefined);
      throw new NyteTransportError({
        kind: "bad_content_type",
        status: response.status,
        contentType: type,
      });
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
    if (!Value.Check(CallReplySchema, parsed)) {
      const issues = validationIssues(Value.Errors(CallReplySchema, parsed));
      throw new NyteTransportError({
        kind: "bad_body",
        detail: `Reply is not a call envelope: ${describeIssues(issues)}`,
        issues,
      });
    }
    return parsed;
  };

  /** The value a successful reply carries, once it fits `schema`. Every failure is one of the two errors. */
  const checkedValue = async <S extends TSchema>(
    response: Response,
    schema: S,
    label: string,
  ): Promise<Static<S>> => {
    const reply = await readReply(response);
    if (!reply.ok) throw new NyteWireError(reply.error, response.status);
    if (!response.ok) throw new NyteTransportError({ kind: "bad_status", status: response.status });
    const value = reply.defined ? reply.value : undefined;
    if (!Value.Check(schema, value)) {
      const issues = validationIssues(Value.Errors(schema, value));
      throw new NyteTransportError({
        kind: "bad_body",
        detail: `Reply to ${label} did not match its schema: ${describeIssues(issues)}`,
        issues,
      });
    }
    return value;
  };

  /** `input` is optional here for operations that take none; `RemoteNyte` requires it where the operation does. */
  async function call<V extends Operation>(
    operation: V,
    input: OperationInput<V> | undefined,
  ): Promise<OperationOutput<V>> {
    const headers = headersFor(JSON_MEDIA_TYPE);
    headers.set("content-type", JSON_MEDIA_TYPE);
    const response = await send(`${base}${CALL_ROUTE_PREFIX}${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input === undefined ? {} : { input }),
    });
    const schema: (typeof OPERATIONS)[V]["output"] = OPERATIONS[operation].output;
    return checkedValue(response, schema, operation);
  }

  /** A refused watch carries a JSON error, never a successful call reply. */
  const refusal = async (response: Response): Promise<never> => {
    const reply = await readReply(response);
    if (!reply.ok) throw new NyteWireError(reply.error, response.status);
    throw new NyteTransportError({ kind: "bad_status", status: response.status });
  };

  const operation =
    <V extends Operation>(name: V) =>
    (input?: OperationInput<V>): Promise<OperationOutput<V>> =>
      call(name, input);

  const info = async (): Promise<ServerInfo> => {
    const response = await send(`${base}${INFO_ROUTE}`, {
      method: "GET",
      headers: headersFor(JSON_MEDIA_TYPE),
    });
    return checkedValue(response, ServerInfoSchema, "info");
  };

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
    info,
    landing: operation("landing"),
    sessions: {
      create: operation("sessions.create"),
      get: operation("sessions.get"),
      snapshot: operation("sessions.snapshot"),
      metadata: operation("sessions.metadata"),
      list: operation("sessions.list"),
      rename: operation("sessions.rename"),
      setPinned: operation("sessions.setPinned"),
      setArchived: operation("sessions.setArchived"),
      delete: operation("sessions.delete"),
      configure: operation("sessions.configure"),
    },
    messages: {
      send: operation("messages.send"),
      cancel: operation("messages.cancel"),
      redeliver: operation("messages.redeliver"),
    },
    runs: {
      current: operation("runs.current"),
      abort: operation("runs.abort"),
      reply: operation("runs.reply"),
      diff: operation("runs.diff"),
      revert: operation("runs.revert"),
    },
    jobs: {
      list: operation("jobs.list"),
      start: operation("jobs.start"),
      background: operation("jobs.background"),
      cancel: operation("jobs.cancel"),
    },
    heads: {
      move: operation("heads.move"),
    },
    workspace: {
      list: operation("workspace.list"),
      current: operation("workspace.current"),
      select: operation("workspace.select"),
      forget: operation("workspace.forget"),
      files: operation("workspace.files"),
      vcs: { diff: operation("workspace.vcs.diff") },
    },
    provider: {
      models: {
        list: operation("provider.models.list"),
        default: operation("provider.models.default"),
      },
    },
    plugins: {
      catalog: operation("plugins.catalog"),
      list: operation("plugins.list"),
      commands: {
        list: operation("plugins.commands.list"),
        run: operation("plugins.commands.run"),
      },
      settings: {
        list: operation("plugins.settings.list"),
        apply: operation("plugins.settings.apply"),
      },
      resources: { list: operation("plugins.resources.list") },
      status: { list: operation("plugins.status.list") },
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
  readonly refusal: (response: Response) => Promise<never>;
}

type Outcome =
  | { readonly kind: "ended" }
  | { readonly kind: "failed"; readonly error: NyteWireError | NyteTransportError };

type BodyReadResult =
  | { readonly done: false; readonly value: Uint8Array }
  | { readonly done: true; readonly value?: Uint8Array };

/** The subset of a stream reader the watch uses. Structural, so a runtime's augmented reader also fits. */
interface BodyReader {
  read(): Promise<BodyReadResult>;
  cancel(): Promise<unknown>;
}

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
  const parser = createSseParser({ maxFrameChars: dependencies.maxFrameChars });
  let queue: SessionEvent[] = [];
  let reader: BodyReader | undefined;
  let outcome: Outcome | undefined;
  /** Resources are released; no more reads happen. */
  let finished = false;
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
    outcome = { kind: "ended" };
    finish();
  }

  if (signal?.aborted === true) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });

  const fail = (error: NyteWireError | NyteTransportError): void => {
    outcome = { kind: "failed", error };
  };

  const settle = (frameKind: string, data: string): void => {
    if (!Value.Check(WatchFrameKindSchema, frameKind)) {
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
        if (Value.Check(schemas.SessionEvent, parsed)) queue.push(parsed);
        else {
          const issues = validationIssues(Value.Errors(schemas.SessionEvent, parsed));
          fail(badFrame(`Watch event did not match its schema: ${describeIssues(issues)}`, issues));
        }
        return;
      }
      case "ended": {
        if (Value.Check(WatchEndedSchema, parsed)) outcome = { kind: "ended" };
        else {
          const issues = validationIssues(Value.Errors(WatchEndedSchema, parsed));
          fail(badFrame(`Watch ended frame is malformed: ${describeIssues(issues)}`));
        }
        return;
      }
      case "error": {
        if (Value.Check(WireErrorSchema, parsed)) fail(new NyteWireError(parsed));
        else {
          const issues = validationIssues(Value.Errors(WireErrorSchema, parsed));
          fail(badFrame(`Watch error frame is malformed: ${describeIssues(issues)}`, issues));
        }
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
      return dependencies.refusal(response);
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
    const result = outcome;
    outcome = { kind: "ended" };
    if (result?.kind === "failed") throw result.error;
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

// ---------------------------------------------------------------------------
// Session fold and observer
// ---------------------------------------------------------------------------

export {
  foldEvent,
  stateFromSnapshot,
  stateWithMetadata,
  tipMismatch,
  waitingCall,
  type FoldOutcome,
  type SessionState,
  type WaitingCall,
} from "./session/session-state.ts";
export {
  SessionObserver,
  type SessionObserverClient,
  type SessionObserverOptions,
  type SessionUpdate,
} from "./session/session-follow.ts";
export { sessionMark, type SessionMark } from "./session/session-status.ts";

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export {
  appendTurnChanges,
  changesFromTurns,
  EMPTY_CHANGES,
  type ChangesState,
  type FileChange,
} from "./views/changes.ts";
export {
  estimateContextTokens,
  estimateModelContextTokens,
  estimateTokens,
  lastAssistantUsageInfo,
  projectContextStatus,
  type AssistantUsageInfo,
  type ContextStatus,
  type ContextUsageEstimate,
} from "./views/context.ts";
export { sessionDirectoryEntry, type SessionDirectoryEntry } from "./views/directory.ts";
export {
  EMPTY_LIVE_PARTS,
  foldLiveParts,
  livePartKey,
  type LivePart,
  type LiveParts,
} from "./views/live-parts.ts";
export {
  parsePatchFacts,
  type ParsedPatch,
  type PatchFile,
  type PatchStat,
} from "./views/patch.ts";
export {
  appendTranscriptCommit,
  EMPTY_TRANSCRIPT,
  transcriptFromCommits,
  turnPartId,
  type ToolTurnPart,
  type TranscriptState,
  type Turn,
  type TurnPart,
  type UserTurnPart,
} from "./views/transcript.ts";
export {
  collectAbandoned,
  navigationTarget,
  projectTree,
  type NavigationTarget,
  type SessionTree,
  type SessionTreeNode,
} from "./views/tree.ts";
export {
  addUsage,
  commitUsage,
  emptyUsageSummary,
  mergeUsageSummaries,
  projectUsage,
  usageTokens,
  type ModelUsage,
  type UsageSubject,
  type UsageSummary,
} from "./views/usage.ts";

// ---------------------------------------------------------------------------
// Shared pure helpers
// ---------------------------------------------------------------------------

export {
  completionTrigger,
  type CompletionTrigger,
  type CompletionTriggerKind,
} from "./completion-trigger.ts";
export {
  branchConfig,
  completionText,
  COMPACTION_SUMMARY_PREFIX,
  contextMessages,
  modelContext,
  type ModelContext,
} from "./context.ts";
export {
  canonicalJson,
  isJsonObject,
  toJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.ts";
export { mergeQueuedLanes } from "./queue-order.ts";
export { isTerminalPhase, type MentionFile } from "@nyte-ai/protocol";
