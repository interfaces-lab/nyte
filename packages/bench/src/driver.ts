/**
 * What a benchmark needs from a host beyond the public SDK: a fake model that
 * streams on command, a way to kill and restart the kernel, and a way to cut
 * the link. The host package supplies one implementation (memory store, local
 * provider over a temp directory); the benchmarks never reach into core.
 */
import type { Connection, Host, ModelRef, PartId, Seq, SessionId, Store } from "@nyte-ai/sdk";

/** One scripted model response: text streamed in `tokens` pieces, then optional tool calls, then text. */
export interface ScriptedTurn {
  readonly text: string;
  readonly tokens: number;
  readonly tools?: readonly { readonly name: string; readonly args: Record<string, unknown> }[];
  readonly after?: string;
}

export interface FakeModel {
  readonly ref: ModelRef;
  /** The next request answers with this turn. Unscripted requests answer with one short text. */
  script(turn: ScriptedTurn): void;
  /** Resolves when the model has emitted `count` tokens of the current response; the response then pauses until `release()`. */
  pauseAfter(count: number): Promise<void>;
  release(): void;
}

export interface BenchHost {
  readonly host: Host;
  readonly model: FakeModel;
  readonly store: Store;
  /** Ends the kernel process-like: no cleanup, no settlement. The store survives. */
  crash(): Promise<void>;
  /** Opens a new kernel over the same store. The returned host replaces `host`. */
  restart(): Promise<Host>;
  /** A connection over the listener, so link loss can be simulated. */
  connect(): Promise<BenchLink>;
  /** Counts of what the environment and the bench tools did, by name. */
  readonly counters: Readonly<Record<string, () => number>>;
  /** Branded ids the bench cannot construct itself. */
  readonly ids: { session(name: string): SessionId; part(name: string): PartId; seq(n: number): Seq };
  close(): Promise<void>;
}

export interface BenchLink {
  readonly connection: Connection;
  /** Cuts the socket; the connection reports reconnecting until `restore()`. */
  drop(): void;
  restore(): void;
  close(): Promise<void>;
}

export interface BenchDriver {
  readonly name: string;
  open(options?: { readonly sessions?: number; readonly messagesPerSession?: number; readonly changedFiles?: number }): Promise<BenchHost>;
}

