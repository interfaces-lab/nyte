/**
 * The one `text/event-stream` decoder the adapters share.
 */

/** One dispatched server-sent event. */
export interface ServerSentEvent {
  /** The `event` field, or null when the event had none. */
  event: string | null;
  /** The event's `data` lines joined with newlines. */
  data: string;
  /** Every non-blank line of the event as received, for error reports. */
  raw: string[];
}

interface DecoderState {
  event: string | null;
  data: string[];
  raw: string[];
}

const LINE_BREAK = /\r\n|\r|\n/;

const FIELD = /^([^:]*):? ?(.*)$/s;

function flushEvent(state: DecoderState): ServerSentEvent | undefined {
  if (state.event === null && state.data.length === 0) return undefined;

  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join("\n"),
    raw: state.raw,
  };

  state.event = null;
  state.data = [];
  state.raw = [];

  return event;
}

function decodeLine(line: string, state: DecoderState): ServerSentEvent | undefined {
  if (line === "") return flushEvent(state);

  state.raw.push(line);

  if (line.startsWith(":")) return undefined;

  const [, field = "", value = ""] = FIELD.exec(line) ?? [];

  if (field === "event") state.event = value;
  else if (field === "data") state.data.push(value);

  return undefined;
}

/**
 * Splits complete lines off `buffer`. A trailing CR waits for the next chunk unless `final`,
 * because it may be the first half of a CRLF.
 */
function* takeLines(buffer: { text: string }, final: boolean): Generator<string> {
  for (let match = LINE_BREAK.exec(buffer.text); match; match = LINE_BREAK.exec(buffer.text)) {
    if (!final && match[0] === "\r" && match.index === buffer.text.length - 1) return;

    yield buffer.text.slice(0, match.index);
    buffer.text = buffer.text.slice(match.index + match[0].length);
  }
}

/**
 * Decodes a `text/event-stream` body per the WHATWG grammar: CR, LF and CRLF line ends split
 * anywhere across chunks, comments, one optional space after the field colon, and a final event
 * flushed at EOF. The body is cancelled when `signal` aborts (rejecting with "Request was
 * aborted"), when no chunk arrives within `idleTimeoutMs` (rejecting with a `TimeoutError`
 * DOMException), and when the consumer stops iterating.
 */
export async function* iterateServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const cancel = () => reader.cancel().catch(() => undefined);

  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  const state: DecoderState = { event: null, data: [], raw: [] };
  const buffer = { text: "" };
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimedOut = false;

  try {
    for (;;) {
      if (signal?.aborted) throw new Error("Request was aborted");

      if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          void cancel();
        }, idleTimeoutMs);
      }

      const { value, done } = await reader.read();
      clearTimeout(idleTimer);

      if (signal?.aborted) throw new Error("Request was aborted");

      if (idleTimedOut) throw new DOMException("SSE idle timeout", "TimeoutError");

      buffer.text += done ? decoder.decode() : decoder.decode(value, { stream: true });

      for (const line of takeLines(buffer, done)) {
        const event = decodeLine(line, state);

        if (event) yield event;
      }

      if (done) break;
    }

    const trailing = buffer.text.length > 0 ? decodeLine(buffer.text, state) : undefined;

    if (trailing) yield trailing;

    const last = flushEvent(state);

    if (last) yield last;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", cancel);
    await cancel();
    reader.releaseLock();
  }
}
