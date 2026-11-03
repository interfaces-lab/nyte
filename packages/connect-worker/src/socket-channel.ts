import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_MESSAGE_LIMIT_BYTES,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeMessage,
} from "@nyte-ai/connect/relay";
import type { DesktopFrame, RelayFrame } from "@nyte-ai/connect/relay";

type Message = Extract<DesktopFrame, { t: "message" }>;

type Close = Extract<DesktopFrame, { t: "close" }>;

const GOING_AWAY = 1001;

const INTERNAL_ERROR = 1011;

function closeCode(code: number): number {
  return (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
    ? code
    : 1000;
}

export class SocketChannel {
  readonly id: string;
  readonly session: string;
  readonly deviceId = undefined;
  readonly #send: (frame: RelayFrame) => void;
  readonly #onDone: () => void;
  readonly #phone: WebSocket;
  readonly #outbox: { readonly data: string; readonly fin: boolean; readonly bytes: number }[] = [];
  #outboxBytes = 0;
  #credit = RELAY_WINDOW_BYTES;
  readonly #inbound: Uint8Array[] = [];
  #inboundBytes = 0;
  #done = false;

  constructor(input: {
    readonly id: string;
    readonly session: string;
    readonly phone: WebSocket;
    readonly send: (frame: RelayFrame) => void;
    readonly onDone: () => void;
  }) {
    this.id = input.id;
    this.session = input.session;
    this.#phone = input.phone;
    this.#send = input.send;
    this.#onDone = input.onDone;
  }

  start(path: string): void {
    this.#send({ t: "socket", ch: this.id, path });
    this.#phone.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.#forward(event.data);
      else {
        this.#send({ t: "close", ch: this.id, code: 1003, reason: "Text frames only." });
        this.#end({ code: 1003, reason: "The host takes text frames only." });
      }
    });
    this.#phone.addEventListener("close", (event) => {
      if (this.#done) return;
      this.#finish();
      this.#send({
        t: "close",
        ch: this.id,
        code: event.code >= 1000 && event.code <= 4999 ? event.code : 1000,
        reason: event.reason.slice(0, 123),
      });
    });
    this.#phone.addEventListener("error", () => this.reset());
  }

  onMessage(frame: Message): boolean {
    const bytes = decodeChunk(frame.data);

    if (bytes === undefined || this.#inboundBytes + bytes.byteLength > RELAY_MESSAGE_LIMIT_BYTES)
      return false;
    this.#inbound.push(bytes);
    this.#inboundBytes += bytes.byteLength;
    this.#send({ t: "credit", ch: this.id, bytes: bytes.byteLength });

    if (!frame.fin) return true;
    const whole = new Uint8Array(this.#inboundBytes);
    let offset = 0;

    for (const chunk of this.#inbound.splice(0)) {
      whole.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.#inboundBytes = 0;

    try {
      this.#phone.send(new TextDecoder().decode(whole));
    } catch {
      this.reset();
    }

    return true;
  }

  onClose(frame: Close): boolean {
    if (this.#done) return true;
    this.#finish();

    try {
      this.#phone.close(closeCode(frame.code), frame.reason);
    } catch {}

    return true;
  }

  onCredit(bytes: number): boolean {
    if (this.#credit + bytes > RELAY_WINDOW_BYTES) return false;
    this.#credit += bytes;
    this.#pump();

    return true;
  }

  onReset(): void {
    this.#end({ code: INTERNAL_ERROR, reason: "The Mac ended the socket." });
  }

  reset(): void {
    if (this.#done) return;
    this.#send({ t: "reset", ch: this.id });
    this.#end({ code: GOING_AWAY, reason: "This Mac is not connected." });
  }

  fail(): void {
    this.#end({ code: GOING_AWAY, reason: "This Mac is not connected." });
  }

  #forward(text: string): void {
    for (const chunk of encodeMessage(text)) {
      const bytes = decodeChunk(chunk.data)?.byteLength ?? 0;
      this.#outbox.push({ ...chunk, bytes });
      this.#outboxBytes += bytes;
    }

    if (this.#outboxBytes > RELAY_BODY_LIMIT_BYTES) {
      this.reset();

      return;
    }

    this.#pump();
  }

  #pump(): void {
    for (let next = this.#outbox[0]; next !== undefined; next = this.#outbox[0]) {
      if (next.bytes > this.#credit) return;
      this.#outbox.shift();
      this.#outboxBytes -= next.bytes;
      this.#credit -= next.bytes;
      this.#send({ t: "message", ch: this.id, data: next.data, fin: next.fin });
    }
  }

  #end(close: { readonly code: number; readonly reason: string }): void {
    if (this.#done) return;
    this.#finish();

    try {
      this.#phone.close(close.code, close.reason);
    } catch {}
  }

  #finish(): void {
    this.#done = true;
    this.#outbox.length = 0;
    this.#inbound.length = 0;
    this.#onDone();
  }
}
