/**
 * Durable tool suspension (design record: "Suspension and wake"). A tool that
 * must wait on the world throws `ToolSuspension` from `execute`; the runner
 * commits a `tool_suspended` record naming the reserved result entry, releases
 * the run's claim, and the run stops consuming any process anywhere. The wake
 * input arrives by ordinary admission; whichever host observes it claims the
 * run and settles the reserved entry exactly once through the tool's `wake`
 * handler.
 */
import type { Message } from "@uji-ai/schema";
import type { AgentToolResult } from "../types.ts";
import type { JsonValue, ProvisionedEntry } from "./session/types.ts";

/**
 * Thrown by a tool's `execute` to settle the call as suspended. `waiting` is
 * the tool's own durable description of the wake condition; core stores it
 * and hands it back to `wake` unread. `entries` are appended to the tree
 * before the suspension commits (an ask's question entry).
 */
export class ToolSuspension {
  readonly waiting: JsonValue;
  readonly entries: readonly ProvisionedEntry[];

  constructor(input: { waiting: JsonValue; entries?: readonly ProvisionedEntry[] }) {
    this.waiting = input.waiting;
    this.entries = input.entries ?? [];
  }
}

/** One suspended call, as the runner hands it to the tool's `wake` handler. */
export interface SuspendedCall {
  readonly waiting: JsonValue;
  readonly toolCallId: string;
  readonly resultEntryId: string;
}

/** A pending queued message offered to a wake handler as candidate input. */
export interface WakeInput {
  readonly entryId: string;
  readonly message: Message;
}

export interface ToolWakeContext {
  readonly signal: AbortSignal;
  /** Steer-lane items pending on the head, in admission order. */
  readonly pending: readonly WakeInput[];
  /**
   * Tombstone a pending item this settlement absorbed, so it never enters the
   * tree as its own message.
   */
  consume(entryId: string): Promise<void>;
}

export type ToolWakeOutcome =
  | { kind: "settle"; result: AgentToolResult<unknown>; isError?: boolean }
  | { kind: "wait" };

/**
 * Settle a suspended call on wake, or keep waiting. Runs on whichever host
 * claims the run after wake input arrives, so it must derive everything from
 * `suspension` and the durable state it can read; it holds no memory of the
 * process that suspended. It must not write anything before deciding to
 * settle: a `wait` outcome may be invoked again.
 */
export type ToolWake = (
  suspension: SuspendedCall,
  context: ToolWakeContext,
) => Promise<ToolWakeOutcome>;
