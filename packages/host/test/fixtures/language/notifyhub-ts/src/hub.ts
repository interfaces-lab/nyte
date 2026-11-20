import { emptyStats, record, type Stats } from "./stats.ts";

/** One notification on its way to a channel. */
export interface Message {
  channel: string;
  subject: string;
  body: string;
}

/** Delivers messages somewhere: a mailbox, a webhook, a pager. */
export interface Channel {
  /** The key messages use to pick this channel. */
  readonly name: string;
  send(message: Message, signal: AbortSignal): Promise<void>;
}

export class UnknownChannelError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(`unknown channel: "${channel}"`);
    this.channel = channel;
  }
}

/** Owns the registered channels and the running counts. */
export class Hub {
  readonly #channels = new Map<string, Channel>();
  #stats: Stats = emptyStats();

  /** Adds a channel, replacing any channel with the same name. */
  register(channel: Channel): void {
    this.#channels.set(channel.name, channel);
    this.#stats.channels[channel.name] ??= { submitted: 0, delivered: 0, failed: 0 };
  }

  /** Sends a message through its channel and records how it went. */
  async submit(message: Message, signal: AbortSignal): Promise<void> {
    const channel = this.#channels.get(message.channel);
    if (!channel) {
      this.#stats = record(this.#stats, undefined, false);
      throw new UnknownChannelError(message.channel);
    }
    try {
      await channel.send(message, signal);
      this.#stats = record(this.#stats, channel.name, true);
    } catch (error) {
      this.#stats = record(this.#stats, channel.name, false);
      throw error;
    }
  }

  /** A copy of the counts so far. */
  stats(): Stats {
    return structuredClone(this.#stats);
  }
}
