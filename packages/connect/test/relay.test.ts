import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  RELAY_CHUNK_BYTES,
  RELAY_FRAME_CHARS,
  RELAY_PING,
  RELAY_PONG,
  RELAY_WINDOW_BYTES,
  RelayPath,
  decodeChunk,
  encodeChunks,
  parseDesktopFrame,
  parseRelayFrame,
  publicRelayTarget,
  relayRefusal,
  relayRequestHeaders,
  relayResponseHeaders,
} from "../src/relay.ts";

const environmentId = "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";
const ch = "AAAAAAAAAAAAAAAAAAAAAA";
const base = `https://connect.example.com/r/${environmentId}`;

const target = (path: string) => publicRelayTarget(new URL(`${base}${path}`));

describe("public relay targets", () => {
  it("forwards API paths with URLSearchParams queries and the device release", () => {
    const query = new URLSearchParams({ sessionId: "a b/../ü?#&=", after: "3" }).toString();

    expect(target("/v1/info")).toEqual({ kind: "api", environmentId, path: "/v1/info" });
    expect(target(`/v1/watch?${query}`)).toEqual({
      kind: "api",
      environmentId,
      path: `/v1/watch?${query}`,
    });
    expect(target("/v1/call/session.prompt")?.path).toBe("/v1/call/session.prompt");
    expect(target("/_nyte/connect/device")).toEqual({
      kind: "release",
      environmentId,
      path: "/_nyte/connect/device",
    });
  });

  it.each([
    "/_nyte/connect/enroll",
    "/_nyte/connect/device?x=1",
    "/v1",
    "/v1/",
    "/v1//info",
    "/v1/info/",
    "/v1/%2e%2e/info",
    "/v1/a%2fb",
    "/v1/a%5Cb",
    "/v1/a%20b",
    "/v1/call/x?a=%zz",
    "/v2/info",
    "/",
    "",
  ])("refuses %s", (path) => {
    expect(target(path)).toBeUndefined();
  });

  it("normalizes dot segments and backslashes before deciding", () => {
    expect(target("/v1/a/%2E/b")?.path).toBe("/v1/a/b");
    expect(target("/v1/a\\b")?.path).toBe("/v1/a/b");
    expect(target("/v1/../_nyte/connect/enroll")).toBeUndefined();
    expect(target("/v1/../../x/v1/info")).toBeUndefined();
  });

  it.each([
    "/v1/..",
    "/v1/../info",
    "/v1/./info",
    "/v1/info/.",
    "/v1/..?a=1",
    "/v1/a\\b",
    "/v1/a%2Fb",
    "/v1/info?a=<b>",
    "/v1/info?a=1#f",
    "/v1/info?a=%0",
    "/v1/info?a=\u0001",
    "/_nyte/connect/device/",
  ])("the path schema refuses %s as sent", (path) => {
    expect(Value.Check(RelayPath, path)).toBe(false);
  });

  it("the path schema keeps segments that only contain dots", () => {
    expect(Value.Check(RelayPath, "/v1/call/a...b")).toBe(true);
    expect(Value.Check(RelayPath, "/v1/...")).toBe(true);
  });

  it("refuses other environments' shapes and other prefixes", () => {
    expect(publicRelayTarget(new URL("https://connect.example.com/r/abc/v1/info"))).toBeUndefined();
    expect(
      publicRelayTarget(new URL(`https://connect.example.com/x/${environmentId}/v1/info`)),
    ).toBeUndefined();
  });
});

describe("frames", () => {
  it("parses each side's frames and nothing of the other's", () => {
    const open = {
      t: "open",
      ch,
      method: "POST",
      path: "/v1/call/session.prompt",
      headers: { authorization: "Bearer x", "content-type": "application/json" },
    };

    expect(parseRelayFrame(JSON.stringify(open))).toEqual(open);
    expect(parseDesktopFrame(JSON.stringify(open))).toBeUndefined();
    expect(parseRelayFrame(RELAY_PONG)).toEqual({ t: "pong" });
    expect(parseDesktopFrame(RELAY_PING)).toEqual({ t: "ping" });

    for (const frame of [
      { t: "head", ch, status: 204, headers: {} },
      { t: "head", ch, status: 200, headers: { "cache-control": "no-store" } },
      { t: "end", ch },
      { t: "credit", ch, bytes: RELAY_WINDOW_BYTES },
    ])
      expect(parseDesktopFrame(JSON.stringify(frame))).toEqual(frame);
  });

  it.each([
    ["a redirect status", { t: "head", ch, status: 302, headers: {} }],
    ["a cookie", { t: "head", ch, status: 200, headers: { "set-cookie": "a=b" } }],
    ["a length", { t: "head", ch, status: 200, headers: { "content-length": "1" } }],
    [
      "a header with a line break",
      { t: "head", ch, status: 200, headers: { "cache-control": "a\r\nb" } },
    ],
    ["a short channel id", { t: "end", ch: "abc" }],
    ["credit past a window", { t: "credit", ch, bytes: RELAY_WINDOW_BYTES + 1 }],
    ["an extra field", { t: "end", ch, extra: true }],
  ])("refuses %s from a desktop", (_, frame) => {
    expect(parseDesktopFrame(JSON.stringify(frame))).toBeUndefined();
  });

  it("refuses binary, oversized, and malformed messages", () => {
    expect(parseDesktopFrame(new ArrayBuffer(4))).toBeUndefined();
    expect(parseDesktopFrame(`{"t":"ping"}${" ".repeat(RELAY_FRAME_CHARS)}`)).toBeUndefined();
    expect(parseRelayFrame("{")).toBeUndefined();
  });

  it("splits bytes into chunks that decode back", () => {
    const bytes = Uint8Array.from({ length: RELAY_CHUNK_BYTES * 2 + 5 }, (_, index) => index % 251);
    const chunks = encodeChunks(bytes);

    expect(chunks).toHaveLength(3);
    expect(encodeChunks(new Uint8Array())).toEqual([]);

    for (const data of chunks)
      expect(parseDesktopFrame(JSON.stringify({ t: "data", ch, data }))).toBeDefined();
    const decoded = chunks.map((data) => decodeChunk(data) ?? new Uint8Array());

    expect(Uint8Array.from(decoded.flatMap((chunk) => [...chunk]))).toEqual(bytes);
  });
});

describe("headers and refusals", () => {
  it("passes only allowlisted headers", () => {
    const request = new Headers({
      authorization: "Bearer t",
      cookie: "a=b",
      host: "evil.example",
      origin: "https://evil.example",
      "x-forwarded-for": "1.2.3.4",
      accept: "text/event-stream",
    });
    const response = new Headers({
      "content-type": "text/event-stream",
      "content-length": "10",
      "content-encoding": "gzip",
      "set-cookie": "a=b",
      location: "http://127.0.0.1",
      "access-control-allow-origin": "*",
    });

    expect(relayRequestHeaders(request)).toEqual({
      authorization: "Bearer t",
      accept: "text/event-stream",
    });
    expect(relayResponseHeaders(response)).toEqual({ "content-type": "text/event-stream" });
  });

  it("answers in the Nyte wire error envelope", async () => {
    const response = relayRefusal("closed");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "closed", message: expect.any(String) },
    });
  });
});
