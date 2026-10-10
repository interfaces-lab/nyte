import type {
  CommitId,
  HeadName,
  MessageId,
  RunId,
  SendOptions,
  SessionId,
  UserContent,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { SendReceipt } from "./receipt.ts";

/** Admits user content to a head for a connection and returns its receipt: replays a known id, runs `before_send` with the context's principal and origin run, resolves the configuration, schedules, and publishes `input admitted` in one set; a `replace` revises a pending input in place or edits a landed one (stop, move, admit) in one set. */
export function send(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly context: ConnectionContext;
    readonly content: UserContent;
    readonly options?: SendOptions;
  },
): Promise<SendReceipt> {
  throw new Error("not implemented");
}

/** Lands admitted inputs on a head into a run, or none: writes their user commits, advances the head, drops them from the inbox, and publishes `input landed` then `commit` per input in one set; returns the commits in `ids` order. */
export function landing(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  ids: readonly MessageId[],
  run: RunId | null,
): Promise<readonly CommitId[]> {
  throw new Error("not implemented");
}
