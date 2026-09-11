import type { Usage } from "../types.ts";

/** Sanitized failure, kept out of the client module so `instanceof` checks stay cheap to import. */
export class OpenAICodexCompactionError extends Error {
  /** Sum of valid terminal usage across attempts; undefined means none was reported. */
  readonly usage: Usage | undefined;

  constructor(message: string, usage?: Usage) {
    super(message);
    this.name = "OpenAICodexCompactionError";
    this.usage = usage;
  }
}
