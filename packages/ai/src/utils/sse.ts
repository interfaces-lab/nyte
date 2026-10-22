/**
 * The one `text/event-stream` decoder the adapters share.
 */

/** One dispatched server-sent event. */
interface ServerSentEvent {
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

interface LineBuffer {
  fragments: string[];
  pendingCr: boolean;
}

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

  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  const value = colon === -1 ? "" : line.slice(colon + (line[colon + 1] === " " ? 2 : 1));

  if (field === "event") state.event = value;
  else if (field === "data") state.data.push(value);

  return undefined;
}

/**
 * Splits complete lines off `buffer`. A trailing CR waits for the next chunk unless `final`,
 * because it may be the first half of a CRLF.
 */
function* takeLines(buffer: LineBuffer, chunk: string, final: boolean): Generator<string> {
  let start = 0;

  if (buffer.pendingCr) {
    if (chunk.length === 0 && !final) return;
    yield buffer.fragments.join("");
    buffer.fragments = [];
    buffer.pendingCr = false;
    if (chunk.startsWith("\n")) start = 1;
  }

  let cr = chunk.indexOf("\r", start);
  let lf = chunk.indexOf("\n", start);

  while (cr !== -1 || lf !== -1) {
    const index = cr === -1 ? lf : lf === -1 ? cr : Math.min(cr, lf);
    const isCr = index === cr;

    buffer.fragments.push(chunk.slice(start, index));

    if (!final && isCr && index === chunk.length - 1) {
      buffer.pendingCr = true;

      return;
    }

    yield buffer.fragments.join("");
    buffer.fragments = [];
    start = index + 1;

    if (isCr && lf === start) start += 1;
    if (cr !== -1 && cr < start) cr = chunk.indexOf("\r", start);
    if (lf !== -1 && lf < start) lf = chunk.indexOf("\n", start);
  }

  if (start < chunk.length) buffer.fragments.push(chunk.slice(start));
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
  const buffer: LineBuffer = { fragments: [], pendingCr: false };
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

      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });

      for (const line of takeLines(buffer, chunk, done)) {
        const event = decodeLine(line, state);

        if (event) yield event;
      }

      if (done) break;
    }

    const text = buffer.fragments.join("");
    const trailing = text.length > 0 ? decodeLine(text, state) : undefined;

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
