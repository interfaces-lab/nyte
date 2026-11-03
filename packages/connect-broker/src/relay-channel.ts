/**
 * One relayed HTTP exchange on the desktop's socket. The request flows out as
 * `open`, `data`, `end`, spending the credit the desktop grants; the response
 * flows back as `head`, `data`, `end`, and this side grants credit only as
 * the phone reads. Neither direction holds more than `RELAY_WINDOW_BYTES`.
 *
 * A response without `cache-control` is answered `no-store`.
 */
import { base64Url } from "@nyte-ai/connect";
import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHUNK_BYTES,
  RELAY_WINDOW_BYTES,
  hasNullBody,
  relayRefusal,
} from "@nyte-ai/connect/relay";
import type {
  DesktopFrame,
  RelayFrame,
  RelayMethod,
  RelayRefusalCode,
  RelayRequestHeaders,
} from "@nyte-ai/connect/relay";

type Head = Extract<DesktopFrame, { t: "head" }>;

/** Where the response is: waiting for `head`, streaming a body, or a bodyless status awaiting `end`. */
type ResponsePhase = "head" | "body" | "bodyless";

export class RelayChannel {
  readonly id: string;
  /** The socket session the channel belongs to. */
  readonly session: string;
  /** The device whose bearer opened it, for a device's revocation. */
  readonly deviceId: string | undefined;
  /** The phone's answer: a refusal, or the desktop's `head` and its body. */
  readonly response: Promise<Response>;
  readonly #send: (frame: RelayFrame) => void;
  readonly #onDone: () => void;
  #answer: (response: Response) => void = () => undefined;
  #phase: ResponsePhase = "head";
  #closed = false;
  /** Request bytes the desktop still accepts. */
  #sendCredit = RELAY_WINDOW_BYTES;
  #creditArrived: (() => void) | undefined;
  #reader: ReadableStreamBYOBReader | undefined;
  #requestEnded = false;
  /** Response bytes the desktop may still send. */
  #receiveCredit = RELAY_WINDOW_BYTES;
  readonly #queue: Uint8Array[] = [];
  #responseEnded = false;
  #controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readable: (() => void) | undefined;

  constructor(input: {
    readonly id: string;
    readonly session: string;
    readonly deviceId: string | undefined;
    readonly send: (frame: RelayFrame) => void;
    readonly onDone: () => void;
  }) {
    this.id = input.id;
    this.session = input.session;
    this.deviceId = input.deviceId;
    this.#send = input.send;
    this.#onDone = input.onDone;
    this.response = new Promise((resolve) => {
      this.#answer = resolve;
    });
  }

  /** Send `open` and start streaming the request body within the desktop's credit. */
  start(input: {
    readonly method: RelayMethod;
    readonly path: string;
    readonly headers: RelayRequestHeaders;
    readonly body: ReadableStream<Uint8Array> | null;
  }): void {
    this.#send({
      t: "open",
      ch: this.id,
      method: input.method,
      path: input.path,
      headers: input.headers,
    });
    void this.#pump(input.body);
  }

  /** False when the frame breaks the contract, which closes the socket. */
  onHead(frame: Head): boolean {
    if (this.#closed) return true;

    if (this.#phase !== "head") return false;
    const headers = new Headers();

    for (const [name, value] of Object.entries(frame.headers))
      if (value !== undefined) headers.set(name, value);

    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");

    if (hasNullBody(frame.status)) {
      this.#phase = "bodyless";
      this.#answer(new Response(null, { status: frame.status, headers }));

      return true;
    }

    this.#phase = "body";
    const body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.#controller = controller;
        },
        pull: (controller) => this.#deliver(controller),
        cancel: () => this.cancel(),
      },
      { highWaterMark: 0 },
    );

    this.#answer(new Response(body, { status: frame.status, headers }));

    return true;
  }

  onData(bytes: Uint8Array): boolean {
    if (this.#closed) return true;

    if (this.#phase !== "body" || this.#responseEnded || bytes.byteLength > this.#receiveCredit)
      return false;
    this.#receiveCredit -= bytes.byteLength;
    this.#queue.push(bytes);
    this.#readable?.();

    return true;
  }

  onEnd(): boolean {
    if (this.#closed) return true;

    if (this.#phase === "head" || this.#responseEnded) return false;
    this.#responseEnded = true;

    if (this.#phase === "bodyless") this.#complete();
    else this.#readable?.();

    return true;
  }

  onCredit(bytes: number): boolean {
    if (this.#closed) return true;

    if (this.#sendCredit + bytes > RELAY_WINDOW_BYTES) return false;
    this.#sendCredit += bytes;
    this.#creditArrived?.();

    return true;
  }

  /** The desktop ended the exchange. */
  onReset(): void {
    this.#fail("closed");
  }

  /** The phone went away: tell the desktop and stop. */
  cancel(): void {
    this.reset("closed");
  }

  /** End the exchange from this side: tell the desktop, then answer the phone with `code` if it has no answer yet. */
  reset(code: RelayRefusalCode): void {
    if (this.#closed) return;
    this.#send({ t: "reset", ch: this.id });
    this.#fail(code);
  }

  /** End the exchange without telling the desktop, as when its socket is gone. */
  fail(code: RelayRefusalCode): void {
    this.#fail(code);
  }

  #fail(code: RelayRefusalCode): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#phase === "head") this.#answer(relayRefusal(code));
    else if (this.#phase === "body" && this.#controller !== undefined)
      this.#controller.error(new Error("The relayed exchange was reset"));
    this.#finish();
  }

  /** The phone has the whole response. A request still streaming is cut off and the desktop told. */
  #complete(): void {
    if (this.#closed) return;

    if (!this.#requestEnded) this.#send({ t: "reset", ch: this.id });
    this.#closed = true;
    this.#finish();
  }

  #finish(): void {
    this.#queue.length = 0;
    this.#creditArrived?.();
    this.#readable?.();
    this.#reader?.cancel().catch(() => undefined);
    this.#onDone();
  }

  async #deliver(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    for (;;) {
      if (this.#closed) return;
      const chunk = this.#queue.shift();

      if (chunk !== undefined) {
        controller.enqueue(chunk);
        this.#receiveCredit += chunk.byteLength;
        this.#send({ t: "credit", ch: this.id, bytes: chunk.byteLength });

        return;
      }

      if (this.#responseEnded) {
        controller.close();
        this.#complete();

        return;
      }

      await new Promise<void>((resolve) => {
        this.#readable = resolve;
      });
      this.#readable = undefined;
    }
  }

  async #credit(): Promise<number> {
    while (this.#sendCredit === 0 && !this.#closed)
      await new Promise<void>((resolve) => {
        this.#creditArrived = resolve;
      });
    this.#creditArrived = undefined;

    return this.#sendCredit;
  }

  /**
   * Stream the request body with BYOB reads no larger than the credit in
   * hand, so a channel never holds more than one chunk of an upload whatever
   * size the phone's chunks arrive in.
   */
  async #pump(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (body !== null) {
      let total = 0;

      try {
        const reader = body.getReader({ mode: "byob" });

        this.#reader = reader;

        for (;;) {
          const credit = await this.#credit();

          if (this.#closed) return;
          const { done, value } = await reader.read(
            new Uint8Array(Math.min(credit, RELAY_CHUNK_BYTES)),
          );

          if (this.#closed) return;

          if (done) break;
          total += value.byteLength;

          if (total > RELAY_BODY_LIMIT_BYTES) {
            this.reset("payload_too_large");

            return;
          }

          if (value.byteLength === 0) continue;
          this.#sendCredit -= value.byteLength;
          this.#send({ t: "data", ch: this.id, data: base64Url(value) });
        }
      } catch {
        this.reset("closed");

        return;
      }
    }

    if (this.#closed) return;
    this.#requestEnded = true;
    this.#send({ t: "end", ch: this.id });
  }
}
