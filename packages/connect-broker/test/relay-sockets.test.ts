import { RELAY_CHUNK_BYTES, decodeChunk, encodeMessage } from "@nyte-ai/connect/relay";
import { describe, expect, it } from "vitest";
import { broker, enrolled, phone, withWorkerdRelay } from "./relay-fixture.ts";

withWorkerdRelay();

function phoneSocket(environmentId: string, query: string): WebSocket {
  return new WebSocket(broker.localUrl(`${broker.origin}/r/${environmentId}/.nyte/ws${query}`));
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) =>
    socket.addEventListener("message", (event) => resolve(event.data), { once: true }),
  );
}

function closed(socket: WebSocket): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) =>
    socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      {
        once: true,
      },
    ),
  );
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The relay refused the socket")), {
      once: true,
    });
  });
}

describe("socket channels", () => {
  it("relays the ticket request as an operation and a ticketed upgrade as a socket channel", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    const ticket = await phone({ environmentId, bearer }, "/.nyte/ws/ticket", { body: "{}" });

    expect(await ticket.text()).toBe("POST /.nyte/ws/ticket");

    const socket = phoneSocket(environmentId, "?ticket=0f1e2d3c-ticket");
    await opened(socket);
    const frame = await desktop.next("socket");

    expect(frame.path).toBe("/.nyte/ws?ticket=0f1e2d3c-ticket");
    socket.close();
  });

  it("carries text both ways, a message larger than one chunk joined back whole", async () => {
    const { environmentId, desktop } = await enrolled();
    const socket = phoneSocket(environmentId, "?ticket=carry");
    await opened(socket);
    const { ch } = await desktop.next("socket");
    const large = JSON.stringify({ c: "e", text: "x".repeat(RELAY_CHUNK_BYTES * 2 + 10) });
    const arrived = nextMessage(socket);
    const chunks = encodeMessage(large);

    expect(chunks.length).toBe(3);

    for (const chunk of chunks) desktop.send({ t: "message", ch, ...chunk });
    expect(await arrived).toBe(large);

    for (const chunk of chunks)
      expect((await desktop.next("credit", (credit) => credit.ch === ch)).bytes).toBe(
        decodeChunk(chunk.data)?.byteLength,
      );

    socket.send('{"c":"e","id":1}');
    const sent = await desktop.next("message", (message) => message.ch === ch);

    expect(sent.fin).toBe(true);
    expect(new TextDecoder().decode(decodeChunk(sent.data))).toBe('{"c":"e","id":1}');
    socket.close();
  });

  it("passes the host's close code and reason to the phone, and the phone's close to the desktop", async () => {
    const { environmentId, desktop } = await enrolled();
    const first = phoneSocket(environmentId, "?ticket=refused");
    await opened(first);
    const refusing = await desktop.next("socket");
    const ended = closed(first);

    desktop.send({ t: "close", ch: refusing.ch, code: 1008, reason: "Update the client." });
    expect(await ended).toEqual({ code: 1008, reason: "Update the client." });

    const second = phoneSocket(environmentId, "?ticket=leaving");
    await opened(second);
    const leaving = await desktop.next("socket");

    second.close(4000, "Done");
    expect(await desktop.next("close", (close) => close.ch === leaving.ch)).toMatchObject({
      code: 4000,
      reason: "Done",
    });
  });

  it("ends the phone's socket when the desktop resets the channel or leaves", async () => {
    const { environmentId, desktop } = await enrolled();
    const socket = phoneSocket(environmentId, "?ticket=reset");
    await opened(socket);
    const { ch } = await desktop.next("socket");
    const ended = closed(socket);

    desktop.send({ t: "reset", ch });
    expect((await ended).code).toBe(1011);

    const other = phoneSocket(environmentId, "?ticket=gone");
    await opened(other);
    await desktop.next("socket");
    const gone = closed(other);

    desktop.close();
    expect((await gone).code).toBe(1001);
  });

  it("refuses an upgrade without a ticket", async () => {
    const { environmentId } = await enrolled();
    const answer = await phone({ environmentId }, "/.nyte/ws", {
      method: "GET",
      headers: { upgrade: "websocket" },
    });

    expect(answer.status).toBe(404);
  });
});
