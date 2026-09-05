/** The SSE codec by the stream shapes a real connection produces. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  SseFrameTooLarge,
  createSseParser,
  encodeSseComment,
  encodeSseFrame,
  type SseFrame,
} from "../src/sse.ts";

const encoder = new TextEncoder();

function feedBytes(chunks: readonly Uint8Array[]): SseFrame[] {
  const parser = createSseParser();
  const frames: SseFrame[] = [];
  for (const chunk of chunks) frames.push(...parser.feed(chunk));
  frames.push(...parser.end());
  return frames;
}

function feedAll(chunks: readonly string[]): SseFrame[] {
  return feedBytes(chunks.map((chunk) => encoder.encode(chunk)));
}

test("a frame split across chunks is dispatched once, whole", () => {
  const frames = feedAll(["event: ev", 'ent\ndata: {"a":', "1}\n", "\n"]);
  assert.deepEqual(frames, [{ event: "event", data: '{"a":1}', id: undefined }]);
});

test("a multibyte character split across chunks decodes as one character", () => {
  const bytes = encoder.encode("data: café\n\n");
  const cut = bytes.indexOf(0xc3) + 1;
  const frames = feedBytes([bytes.slice(0, cut), bytes.slice(cut)]);
  assert.deepEqual(
    frames.map((frame) => frame.data),
    ["café"],
  );
});

test("CRLF, lone CR, and LF all end a line, including a CRLF split between chunks", () => {
  const frames = feedAll(["data: one\r", "\ndata: two\r\r\n", "data: three\n\n"]);
  assert.deepEqual(
    frames.map((frame) => frame.data),
    ["one\ntwo", "three"],
  );
});

test("several data lines join with a newline and the trailing newline is dropped", () => {
  const frames = feedAll(["data: first\ndata: second\ndata:\n\n"]);
  assert.deepEqual(frames, [{ event: undefined, data: "first\nsecond\n", id: undefined }]);
});

test("comments and unknown fields dispatch nothing; ids persist across frames", () => {
  const frames = feedAll([": keepalive\n\n", "retry: 5\nid: 7\ndata: a\n\n", "data: b\n\n"]);
  assert.deepEqual(
    frames.map((frame) => [frame.data, frame.id]),
    [
      ["a", "7"],
      ["b", "7"],
    ],
  );
});

test("a frame left unterminated at end of stream is discarded", () => {
  assert.deepEqual(
    feedAll(["data: complete\n\n", "data: partial\n"]).map((f) => f.data),
    ["complete"],
  );
});

test("one leading byte order mark is dropped; a second one is part of the field name", () => {
  assert.deepEqual(
    feedAll(["\ufeffdata: x\n\n"]).map((frame) => frame.data),
    ["x"],
  );
  assert.deepEqual(feedAll(["\ufeff\ufeffdata: x\n\n"]), []);
});

test("the encoder round-trips data with embedded newlines and refuses a multi-line event name", () => {
  const encoded = encodeSseFrame({ event: "event", id: "3", data: "line1\nline2" });
  assert.deepEqual(feedAll([encoded]), [{ event: "event", data: "line1\nline2", id: "3" }]);
  assert.throws(() => encodeSseFrame({ event: "a\nb", data: "" }), TypeError);
  assert.deepEqual(feedAll([encodeSseComment("keepalive")]), []);
});

test("a line that never ends is refused at the bound, however it is chunked, and nothing follows", () => {
  const parser = createSseParser({ maxFrameChars: 64 });
  for (let index = 0; index < 100; index += 1) parser.feed(encoder.encode("x"));
  assert.ok(parser.overflow instanceof SseFrameTooLarge);
  assert.deepEqual(parser.feed(encoder.encode("\ndata: late\n\n")), []);
  assert.deepEqual(parser.end(), []);
});

test("data lines that never reach a blank line are refused at the bound", () => {
  const parser = createSseParser({ maxFrameChars: 64 });
  for (let index = 0; index < 100; index += 1) parser.feed(encoder.encode("data: 0123456789\n"));
  assert.ok(parser.overflow instanceof SseFrameTooLarge);
});

test("frames completed before an oversized one in the same chunk are still returned", () => {
  const parser = createSseParser({ maxFrameChars: 64 });
  const frames = parser.feed(encoder.encode(`data: first\n\ndata: ${"y".repeat(100)}`));
  assert.deepEqual(
    frames.map((frame) => frame.data),
    ["first"],
  );
  assert.ok(parser.overflow instanceof SseFrameTooLarge);
});

test("the bound is per frame: many small frames pass through a small bound", () => {
  const parser = createSseParser({ maxFrameChars: 64 });
  let count = 0;
  for (let index = 0; index < 1_000; index += 1) {
    count += parser.feed(
      encoder.encode("event: event\ndata: 0123456789012345678901234567890123\n\n"),
    ).length;
  }
  assert.equal(count, 1_000);
  assert.equal(parser.overflow, undefined);
  assert.throws(() => createSseParser({ maxFrameChars: 0 }), RangeError);
});
