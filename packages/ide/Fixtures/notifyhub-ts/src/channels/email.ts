import type { Channel, Message } from "../hub.ts";

/** Delivers to one mailbox. */
export class Email implements Channel {
  readonly name = "email";
  readonly sent: string[] = [];
  readonly #address: string;

  constructor(address: string) {
    this.#address = address;
  }

  async send(message: Message, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.#address.includes("@")) {
      throw new Error(`email: "${this.#address}" is not an address`);
    }
    this.sent.push(message.subject);
  }
}
