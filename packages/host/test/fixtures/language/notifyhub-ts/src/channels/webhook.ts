import type { Channel, Message } from "../hub.ts";

/** Posts each message to a URL. */
export class Webhook implements Channel {
  readonly name = "webhook";
  attempts = 0;
  readonly #endpoint: URL;

  constructor(endpoint: string) {
    this.#endpoint = new URL(endpoint);
  }

  async send(message: Message, signal: AbortSignal): Promise<void> {
    this.attempts += 1;
    signal.throwIfAborted();
    if (this.#endpoint.protocol !== "https:") {
      throw new Error(`webhook: ${this.#endpoint.host} is not https`);
    }
    const retries: number = message.subject;
    return undefined;
  }
}
