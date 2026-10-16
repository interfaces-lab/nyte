import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createTransport, declarations } from "@nyte-ai/protocol";
import {
  CANCEL_PATH,
  CHANNEL_HEADER,
  CHANNEL_PATH,
  STREAM_HEADER,
} from "../../protocol/src/stream-channel.ts";
import {
  PUBLIC_RELAY_BEARER,
  RELAY_CHUNK_BYTES,
  RELAY_FRAME_CHARS,
  RELAY_OPERATIONS,
  RELAY_PING,
  RELAY_PONG,
  RELAY_REFUSALS,
  RELAY_REQUEST_HEADER_NAMES,
  RELAY_RESPONSE_HEADER_NAMES,
  RELAY_STREAMS,
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
import type { RelayRefusalCode } from "../src/relay.ts";

const environmentId = "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";
const ch = "AAAAAAAAAAAAAAAAAAAAAA";
const base = `https://connect.example.com/r/${environmentId}`;

const target = (path: string) => publicRelayTarget(new URL(`${base}${path}`));

const refusals = Object.keys(RELAY_REFUSALS).filter((name): name is RelayRefusalCode =>
  Object.hasOwn(RELAY_REFUSALS, name),
);

describe("public relay targets", () => {
  it("names every row of protocol's declarations table and nothing else", () => {
    expect([...RELAY_OPERATIONS].sort()).toEqual(Object.keys(declarations).sort());
  });

  it("carries protocol's stream channel: its paths, the stream headers, and the channel id back", () => {
    expect(RELAY_STREAMS).toEqual({ channel: `/${CHANNEL_PATH}`, cancel: `/${CANCEL_PATH}` });
    expect(target(`/${CHANNEL_PATH}`)).toEqual({ kind: "api", environmentId, path: `/${CHANNEL_PATH}` });
    expect(target(`/${CANCEL_PATH}`)).toEqual({ kind: "api", environmentId, path: `/${CANCEL_PATH}` });
    expect(RELAY_REQUEST_HEADER_NAMES).toEqual(
      expect.arrayContaining([CHANNEL_HEADER.toLowerCase(), STREAM_HEADER.toLowerCase()]),
    );
    expect(RELAY_RESPONSE_HEADER_NAMES).toContain(CHANNEL_HEADER.toLowerCase());
  });

  it("forwards each operation, the discovery routes, and the device release", () => {
    for (const name of RELAY_OPERATIONS)
      expect(target(`/${name}`)).toEqual({ kind: "api", environmentId, path: `/${name}` });
    const nonce = new URLSearchParams({ nonce: crypto.randomUUID() }).toString();

    expect(target(`/.nyte/identity?${nonce}`)).toEqual({
      kind: "discovery",
      environmentId,
      path: `/.nyte/identity?${nonce}`,
    });
    expect(target("/.nyte/describe")).toEqual({
      kind: "discovery",
      environmentId,
      path: "/.nyte/describe",
    });
    expect(target("/_nyte/connect/device")).toEqual({
      kind: "release",
      environmentId,
      path: "/_nyte/connect/device",
    });
  });

  it("asks a bearer of every target but the discovery routes", () => {
    const bearers = [
      "/sessions.list",
      "/.nyte/identity?nonce=n1",
      "/.nyte/describe",
      "/_nyte/connect/device",
    ].map((path) => {
      const found = target(path);

      return found === undefined ? undefined : PUBLIC_RELAY_BEARER[found.kind];
    });

    expect(bearers).toEqual(["active", "none", "none", "reserved-or-active"]);
  });

  it.each([
    "/_nyte/connect/enroll",
    "/_nyte/connect/device?x=1",
    "/sessions.list?x=1",
    "/sessions.list/",
    "/sessions.lis",
    "/sessions",
    "/session.prompt",
    "/v1/info",
    "/v1/call/sessions.list",
    "/x/sessions.list",
    "/.nyte/describe?x=1",
    "/.nyte/identity/",
    "/.nyte/other",
    "/nyte/identity",
    "/",
    "",
  ])("refuses %s", (path) => {
    expect(target(path)).toBeUndefined();
  });

  it("normalizes dot segments and backslashes before deciding", () => {
    expect(target("/x/../sessions.list")?.path).toBe("/sessions.list");
    expect(target("/x/%2E%2E/sessions.list")?.path).toBe("/sessions.list");
    expect(target("/x\\..\\sessions.list")?.path).toBe("/sessions.list");
    expect(target("/sessions.list/../_nyte/connect/enroll")).toBeUndefined();
    expect(target("/../../x/sessions.list")).toBeUndefined();
  });

  it.each([
    "/sessions.list/..",
    "/./sessions.list",
    "/sessions%2Elist",
    "/sessions.list?a=1",
    "/.nyte/identity?a=<b>",
    "/.nyte/identity?a=1#f",
    "/.nyte/identity?a=%0",
    "/.nyte/identity?a=\u0001",
    "/_nyte/connect/device/",
  ])("the path schema refuses %s as sent", (path) => {
    expect(Value.Check(RelayPath, path)).toBe(false);
  });

  it("refuses other environments' shapes and other prefixes", () => {
    expect(
      publicRelayTarget(new URL("https://connect.example.com/r/abc/sessions.list")),
    ).toBeUndefined();
    expect(
      publicRelayTarget(new URL(`https://connect.example.com/x/${environmentId}/sessions.list`)),
    ).toBeUndefined();
  });
});

describe("frames", () => {
  it("parses each side's frames and nothing of the other's", () => {
    const open = {
      t: "open",
      ch,
      method: "POST",
      path: "/files.write",
      headers: {
        authorization: "Bearer x",
        "content-type": "application/octet-stream",
        "x-nyte-input": "eyJwYXRoIjoiYSJ9",
      },
    };

    expect(parseRelayFrame(JSON.stringify(open))).toEqual(open);
    expect(parseDesktopFrame(JSON.stringify(open))).toBeUndefined();
    expect(parseRelayFrame(RELAY_PONG)).toEqual({ t: "pong" });
    expect(parseDesktopFrame(RELAY_PING)).toEqual({ t: "ping" });

    for (const frame of [
      { t: "head", ch, status: 204, headers: {} },
      { t: "head", ch, status: 200, headers: { "cache-control": "no-store" } },
      {
        t: "head",
        ch,
        status: 200,
        headers: { "x-nyte-host": "host_1", "x-nyte-version": "v1", "x-nyte-mime": "image/png" },
      },
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
      "last-event-id": "7",
      "x-nyte-input": "e30",
      "x-nyte-other": "1",
    });
    const response = new Headers({
      "content-type": "text/event-stream",
      "content-length": "10",
      "content-encoding": "gzip",
      "set-cookie": "a=b",
      location: "http://127.0.0.1",
      "access-control-allow-origin": "*",
      "x-nyte-host": "host_1",
      "x-nyte-credential": "token",
      "x-nyte-version": "v1",
      "x-nyte-mime": "text/plain",
      "x-nyte-input": "e30",
    });

    expect(relayRequestHeaders(request)).toEqual({
      authorization: "Bearer t",
      accept: "text/event-stream",
      "last-event-id": "7",
      "x-nyte-input": "e30",
    });
    expect(relayResponseHeaders(response)).toEqual({
      "content-type": "text/event-stream",
      "x-nyte-host": "host_1",
      "x-nyte-credential": "token",
      "x-nyte-version": "v1",
      "x-nyte-mime": "text/plain",
    });
  });

  it.each(refusals)("answers %s as the wire error a protocol client rethrows", async (refusal) => {
    const { code, message } = RELAY_REFUSALS[refusal];

    const transport = createTransport({
      url: base,
      headers: async () => ({}),
      fetch: async () => relayRefusal(refusal),
    });

    await expect(transport.invoke("sessions.list", {})).rejects.toMatchObject({
      name: "SdkError",
      code,
      message,
    });
  });
});
