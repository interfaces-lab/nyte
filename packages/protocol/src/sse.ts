/**
 * Server-sent events, both directions. The encoder writes one frame; the
 * parser turns a byte stream into frames by the WHATWG event-stream rules:
 * UTF-8 decoded across chunk boundaries, lines ended by LF, CRLF, or CR,
 * several `data:` lines joined with LF, comment lines dropped, and a frame
 * dispatched only on its terminating blank line. Bytes left when the stream
 * ends are discarded, as the specification says.
 *
 * The parser bounds what one frame may hold. A peer that never ends a line,
 * or never sends the blank line that ends a frame, cannot make it grow
 * without limit.
 */

export interface SseFrame {
  /** The `event:` field, when the frame named one. */
  readonly event: string | undefined;
  readonly data: string;
  /** The last `id:` seen on the stream, when any frame set one. */
  readonly id: string | undefined;
}

export interface SseFrameInput {
  readonly event?: string;
  readonly data: string;
  readonly id?: string;
}

function assertSingleLine(field: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new TypeError(`SSE ${field} must not contain a line break`);
}

export function encodeSseFrame(frame: SseFrameInput): string {
  let out = "";

  if (frame.id !== undefined) {
    assertSingleLine("id", frame.id);
    out += `id: ${frame.id}\n`;
  }

  if (frame.event !== undefined) {
    assertSingleLine("event", frame.event);
    out += `event: ${frame.event}\n`;
  }

  for (const line of frame.data.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;

  return `${out}\n`;
}

/** A comment frame: keeps a connection warm, dispatches nothing. */
export function encodeSseComment(text: string): string {
  assertSingleLine("comment", text);

  return `: ${text}\n\n`;
}

export interface SseParserOptions {
  /**
   * Maximum decoded UTF-16 code units per frame, including field names,
   * comments, line endings, and the terminating blank line. This is string
   * length, not bytes. Counting raw text makes the limit independent of
   * chunk boundaries and bounds persistent ids as well as data fields.
   * Past it, `overflow` is set, retained state is released, frames completed
   * before the offending one are returned, and parsing stops. Default 4 194 304.
   */
  readonly maxFrameChars?: number;
}

export const DEFAULT_MAX_FRAME_CHARS = 4_194_304;

/** A frame outgrew `maxFrameChars`. The stream is not trustworthy past this point. */
export class SseFrameTooLarge extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`SSE frame exceeds ${String(limit)} characters`);
    this.name = "SseFrameTooLarge";
    this.limit = limit;
  }
}

export interface SseParser {
  /** Frames completed by this chunk, in order; none once `overflow` is set. */
  feed(chunk: Uint8Array): SseFrame[];
  /** Flush the decoder at end of stream. An unterminated frame is dropped. */
  end(): SseFrame[];
  /** Set once a frame outgrew `maxFrameChars`. The stream is not trustworthy past it. */
  readonly overflow: SseFrameTooLarge | undefined;
}

export function createSseParser(options: SseParserOptions = {}): SseParser {
  const limit = options.maxFrameChars ?? DEFAULT_MAX_FRAME_CHARS;

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("maxFrameChars must be a positive integer");
  }

  // The decoder drops one leading byte order mark itself, as the stream format asks.
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  /** Characters of `buffer` already searched for a line end; a long line is scanned once. */
  let scanned = 0;
  let data = "";
  let hasData = false;
  let eventType = "";
  let lastId: string | undefined;
  /** Decoded code units consumed since the last blank line, including delimiters. */
  let frameChars = 0;
  let overflow: SseFrameTooLarge | undefined;

  const overflowFrame = (): void => {
    overflow = new SseFrameTooLarge(limit);
    buffer = "";
    scanned = 0;
    data = "";
    hasData = false;
    eventType = "";
    lastId = undefined;
    frameChars = 0;
  };

  const dispatch = (): SseFrame | undefined => {
    const frame = hasData
      ? {
          event: eventType === "" ? undefined : eventType,
          data: data.endsWith("\n") ? data.slice(0, -1) : data,
          id: lastId,
        }
      : undefined;

    data = "";
    hasData = false;
    eventType = "";
    frameChars = 0;

    return frame;
  };

  const field = (line: string): void => {
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);

    if (value.startsWith(" ")) value = value.slice(1);

    switch (name) {
      case "event":
        eventType = value;

        return;
      case "data":
        data += `${value}\n`;
        hasData = true;

        return;
      case "id":
        if (!value.includes("\0")) lastId = value;

        return;
      default:
        return;
    }
  };

  const drain = (final: boolean): SseFrame[] => {
    const frames: SseFrame[] = [];
    let start = 0;

    for (;;) {
      let end = -1;
      let next = 0;

      for (let index = Math.max(start, scanned); index < buffer.length; index += 1) {
        const char = buffer.charCodeAt(index);

        if (char === 10) {
          end = index;
          next = index + 1;
          break;
        }

        if (char === 13) {
          // A CR at the very end may be the first half of a CRLF still in flight.
          if (index === buffer.length - 1 && !final) break;
          end = index;
          next = buffer.charCodeAt(index + 1) === 10 ? index + 2 : index + 1;
          break;
        }
      }

      if (end === -1) break;
      frameChars += next - start;

      if (frameChars > limit) {
        overflowFrame();

        return frames;
      }

      const line = buffer.slice(start, end);
      start = next;

      if (line === "") {
        const frame = dispatch();

        if (frame !== undefined) frames.push(frame);
      } else {
        field(line);
      }
    }

    buffer = buffer.slice(start);
    // Everything up to the last character was searched; the last one may be a CR awaiting its LF.
    scanned = Math.max(0, buffer.length - 1);

    if (frameChars + buffer.length > limit) overflowFrame();

    return frames;
  };

  return {
    get overflow() {
      return overflow;
    },
    feed(chunk) {
      if (overflow !== undefined) return [];
      buffer += decoder.decode(chunk, { stream: true });

      return drain(false);
    },
    end() {
      if (overflow !== undefined) return [];
      buffer += decoder.decode();
      const frames = drain(true);
      buffer = "";
      scanned = 0;
      dispatch();

      return frames;
    },
  };
}
