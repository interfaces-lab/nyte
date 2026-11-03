import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Listener } from "@nyte-ai/core";
import { assert } from "vitest";

export async function rawConnect(listener: Listener, token: string) {
  const address = new URL(listener.address ?? "");

  const upgraded = await new Promise<{ readonly socket: Duplex; readonly head: Buffer }>(
    (done, failed) => {
      const sent = request({
        host: address.hostname,
        port: address.port,
        path: "/.nyte/ws",
        headers: {
          Authorization: `Bearer ${token}`,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        },
      });

      sent.once("upgrade", (_response: IncomingMessage, socket: Duplex, head: Buffer) => {
        socket.pause();
        done({ socket, head });
      });
      sent.once("error", failed);
      sent.end();
    },
  );

  const socket = upgraded.socket;

  return {
    write(text: string): void {
      socket.write(maskedFrame(Buffer.from(text, "utf8")));
    },
    async closing(): Promise<{ readonly code: number; readonly reason: string }> {
      let buffered = upgraded.head;

      for await (const chunk of socket) {
        assert(Buffer.isBuffer(chunk));
        buffered = Buffer.concat([buffered, chunk]);

        for (;;) {
          const frame = readFrame(buffered);

          if (frame === null) break;
          buffered = buffered.subarray(frame.size);

          if (frame.opcode === 8)
            return {
              code: frame.payload.readUInt16BE(0),
              reason: frame.payload.subarray(2).toString("utf8"),
            };
        }
      }

      return { code: 0, reason: "ended" };
    },
  };
}

function maskedFrame(payload: Buffer): Buffer {
  const mask = randomBytes(4);

  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);

  const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));

  return Buffer.concat([header, mask, masked]);
}

function readFrame(
  buffered: Buffer,
): { readonly opcode: number; readonly payload: Buffer; readonly size: number } | null {
  if (buffered.length < 2) return null;
  const opcode = (buffered[0] ?? 0) & 0x0f;
  const short = (buffered[1] ?? 0) & 0x7f;
  const offset = short === 126 ? 4 : short === 127 ? 10 : 2;

  if (buffered.length < offset) return null;

  const length =
    short === 126
      ? buffered.readUInt16BE(2)
      : short === 127
        ? Number(buffered.readBigUInt64BE(2))
        : short;

  if (buffered.length < offset + length) return null;

  return {
    opcode,
    payload: buffered.subarray(offset, offset + length),
    size: offset + length,
  };
}
