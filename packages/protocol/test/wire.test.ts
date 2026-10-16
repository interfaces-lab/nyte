import { asId, SdkError } from "@nyte-ai/schema";
import type { ByteReader, Json, OutputFrame, SdkErrorCode, SdkErrorWire } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { assert, describe, expect, it } from "vitest";
import {
  decodeError,
  encodeError,
  errorStatus,
  octetStream,
  outputFrames,
  parseOutputFrames,
  parseSse,
  readInputHeader,
  sseFrames,
  statusCode,
  withInputHeader,
} from "../src/index.ts";
import { parseJson } from "../src/json.ts";
import { endless } from "./endless.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const codesAgree: Same<SdkErrorCode, SdkErrorWire["code"]> = true;

async function* frames<T>(...values: readonly T[]): AsyncGenerator<T> {
  yield* values;
}

function trickle(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();

        return;
      }

      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];

  for await (const value of source) values.push(value);

  return values;
}

describe("errors", () => {
  it("serialises an SdkError and rebuilds the same class with every field", () => {
    const error = new SdkError("invalid", "Bad input.", {
      hostId: asId("h1"),
      issues: [{ severity: "error", path: ["content", 0], message: "Required." }],
      correlation: "c1",
    });
    const wire = encodeError(error);
    const decoded = decodeError(structuredClone(wire));

    expect(codesAgree).toBe(true);
    expect(decoded).toBeInstanceOf(SdkError);
    expect(encodeError(decoded)).toEqual(wire);
    expect(decoded.message).toBe("Bad input.");
  });

  it("answers a body that is not a wire error by its status, internal without one", () => {
    expect(decodeError({ oops: true }).code).toBe("internal");
    expect(decodeError("Nope.", 401)).toMatchObject({ code: "unauthenticated", message: "Nope." });
    expect(decodeError(null, 413).code).toBe("invalid");
  });

  it("maps every code to its status and back", () => {
    expect(errorStatus).toEqual({
      invalid: 400,
      unauthenticated: 401,
      denied: 403,
      unknown: 404,
      stale: 409,
      internal: 500,
      unavailable: 503,
    });

    for (const [code, status] of Object.entries(errorStatus)) expect(statusCode(status)).toBe(code);
    expect(statusCode(418)).toBe("internal");
  });
});

describe("server-sent events", () => {
  it("frames data and parses it back across any chunking", async () => {
    const sent: readonly Json[] = [
      { kind: "run", seq: 3, text: "é\nline" },
      null,
      [1, null, "two"],
    ];
    const bytes = await readBytes(sseFrames(frames(...sent)));
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith('data: {"kind":"run"')).toBe(true);
    expect(await collect(parseSse(trickle(bytes, 1)))).toEqual(sent);
    expect(await collect(parseSse(trickle(bytes, 7)))).toEqual(sent);
  });

  it("skips comments and parses CRLF line ends and multi-line data", async () => {
    const raw = ': ping\r\n\r\nid: 9\r\ndata: {"a":\r\ndata: 1}\r\n\r\n';

    expect(await collect(parseSse(trickle(new TextEncoder().encode(raw), 3)))).toEqual([{ a: 1 }]);
  });

  it("sends a ping while the source waits", async () => {
    const reader = sseFrames(
      {
        async *[Symbol.asyncIterator]() {
          await new Promise((resolve) => setTimeout(resolve, 40));
          yield 1;
        },
      },
      { heartbeatMs: 5 },
    ).getReader();
    const first = await reader.read();
    await reader.cancel();

    expect(new TextDecoder().decode(first.value)).toBe(": ping\n\n");
  });

  it("ends with an error event the parser throws as the same SdkError", async () => {
    const source = {
      async *[Symbol.asyncIterator]() {
        yield "first";
        throw new SdkError("stale", "Moved.");
      },
    };
    const parsed: Json[] = [];

    await expect(async () => {
      for await (const frame of parseSse(sseFrames(source))) parsed.push(frame);
    }).rejects.toMatchObject({ code: "stale", message: "Moved." });
    expect(parsed).toEqual(["first"]);
  });

  it("returns the source when the stream is cancelled", async () => {
    let returned = false;
    const source: AsyncIterable<Json> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: 1 }),
        return: async () => {
          returned = true;

          return { done: true, value: undefined };
        },
      }),
    };
    const reader = sseFrames(source).getReader();
    await reader.read();
    await reader.cancel();

    expect(returned).toBe(true);
  });
});

describe("output frames", () => {
  it("frames bytes and control frames and parses them back across any chunking", async () => {
    const sent: readonly OutputFrame[] = [
      { kind: "bytes", data: new TextEncoder().encode("hello ") },
      { kind: "gap" },
      { kind: "bytes", data: new Uint8Array([0, 1, 255]) },
      { kind: "exit", code: 0 },
    ];
    const bytes = await readBytes(outputFrames(frames(...sent)));

    expect(Array.from(bytes.slice(0, 5))).toEqual([0, 0, 0, 0, 6]);
    expect(bytes[11]).toBe(1);
    expect(await collect(parseOutputFrames(trickle(bytes, 1)))).toEqual(sent);
    expect(await collect(parseOutputFrames(trickle(bytes, 4)))).toEqual(sent);
  });

  it("skips a control frame of an unknown kind and throws a carried error", async () => {
    const control = (json: string): Uint8Array => {
      const payload = new TextEncoder().encode(json);
      const frame = new Uint8Array(5 + payload.byteLength);
      frame[0] = 1;
      new DataView(frame.buffer).setUint32(1, payload.byteLength);
      frame.set(payload, 5);

      return frame;
    };
    const bytes = new Uint8Array([
      ...control('{"kind":"resized","columns":80}'),
      ...control('{"kind":"exit","code":null}'),
    ]);

    expect(await collect(parseOutputFrames(trickle(bytes, 2)))).toEqual([
      { kind: "exit", code: null },
    ]);

    const failing = {
      async *[Symbol.asyncIterator](): AsyncGenerator<OutputFrame> {
        yield { kind: "gap" };
        throw new SdkError("unavailable", "Gone.");
      },
    };

    await expect(collect(parseOutputFrames(outputFrames(failing)))).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("json", () => {
  it("parses JSON text and refuses text whose value JSON cannot carry", () => {
    expect(parseJson('{"a":[1,"b",null,true]}')).toEqual({ a: [1, "b", null, true] });
    expect(() => parseJson("1e400")).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => parseJson('{"a":[1e400]}')).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => parseJson("{")).toThrow(expect.objectContaining({ code: "invalid" }));
  });
});

describe("byte bodies", () => {
  it("carries a JSON input in X-Nyte-Input beside the bytes", async () => {
    const input = { workspace: "w1", path: "ünïcode/π.txt", options: { parents: true } };
    const init = withInputHeader(input, new Uint8Array([1, 2, 3]));
    const request = new Request("http://host.test/files.write", init);

    expect(init.headers["X-Nyte-Input"]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readInputHeader(request)).toEqual(input);
    expect([...(await readBytes(request.body ?? new ReadableStream()))]).toEqual([1, 2, 3]);
    expect(readInputHeader(new Request("http://host.test/x", { method: "POST" }))).toBeNull();
    expect(() =>
      readInputHeader(new Request("http://host.test/x", { headers: { "X-Nyte-Input": "%%%" } })),
    ).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("answers a reader as an octet stream and closes it when cancelled", async () => {
    let closed = 0;
    const reader: ByteReader = {
      size: 6,
      mime: "image/png",
      async *chunks() {
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array([4, 5, 6]);
      },
      close: async () => {
        closed += 1;
      },
      [Symbol.asyncDispose]: async () => undefined,
    };
    const live = new AbortController().signal;
    const response = octetStream({ reader, headers: { "X-Nyte-Version": "v1" } }, live);

    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("X-Nyte-Mime")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(response.headers.get("X-Nyte-Version")).toBe("v1");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(closed).toBe(1);

    const cancelled = octetStream({ reader: { ...reader, mime: null, size: null } }, live);

    expect(cancelled.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(cancelled.headers.get("X-Nyte-Mime")).toBeNull();
    expect(cancelled.headers.get("Content-Length")).toBeNull();
    await cancelled.body?.cancel();
    expect(closed).toBe(2);
  });

  it("closes the reader once and errors the body when the request aborts mid-read (ADV G P5)", async () => {
    const reader = endless();
    const controller = new AbortController();
    const body = octetStream({ reader }, controller.signal).body?.getReader();

    assert(body !== undefined);
    expect((await body.read()).value).toEqual(Uint8Array.of(7));
    const pending = body.read();
    controller.abort();

    await expect(pending).rejects.toThrow();
    await expect(body.read()).rejects.toThrow();
    expect(reader.closes()).toBe(1);
  });

  it("reports a provider close that fails on abort and still returns the chunk iterator (ADV G11, probe N4)", async () => {
    let returned = 0;
    const lines: string[] = [];
    const sink = dev.sink;

    const reader: ByteReader = {
      size: null,
      mime: null,
      chunks: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
          return: async () => {
            returned += 1;

            return { done: true, value: undefined };
          },
        }),
      }),
      close: async () => {
        throw new Error("Provider close I/O failed.");
      },
      [Symbol.asyncDispose]: async () => undefined,
    };

    dev.on((line) => {
      lines.push(line);
    });

    try {
      const controller = new AbortController();
      const body = octetStream({ reader }, controller.signal).body?.getReader();

      assert(body !== undefined);
      const pending = body.read();
      controller.abort();

      await expect(pending).rejects.toThrow();
      await expect.poll(() => returned).toBe(1);
      await expect
        .poll(() =>
          lines.filter((line) => line.startsWith("DEV:protocol byte reader close failed")),
        )
        .toEqual([
          'DEV:protocol byte reader close failed {"message":"Provider close I/O failed."}',
        ]);
    } finally {
      dev.sink = sink;
    }
  });
});
