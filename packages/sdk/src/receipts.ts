import { BatchOutcomeSchema, MoveOutcomeSchema, RunEndSchema } from "@nyte-ai/schema";
import type {
  BatchOutcome,
  Json,
  MessageId,
  MoveOutcome,
  ReceiptId,
  RunId,
  Schema,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { Receipt, Run, SendReceipt } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

export type SendOutcome = Awaited<ReturnType<SendReceipt["settled"]>>;

export function receiptHandle<O>(
  rows: Rows,
  session: SessionId | null,
  id: ReceiptId,
  outcome: (value: Json) => O,
): Receipt<O> {
  const input = { session, receipt: id };

  return {
    id,
    async status() {
      const status = await rows.call("receipt.status", input);

      return status.kind === "settled"
        ? { kind: "settled", outcome: outcome(status.outcome) }
        : status;
    },
    async settled(options) {
      return outcome(await rows.wait("receipt.settled", input, options));
    },
    async stop() {
      const stopped = await rows.call("receipt.stop", input);

      return stopped.kind === "settled"
        ? { kind: "settled", outcome: outcome(stopped.outcome) }
        : stopped;
    },
  };
}

export function sendReceipt(
  rows: Rows,
  session: SessionId,
  id: ReceiptId,
  message: MessageId,
): SendReceipt {
  return {
    ...receiptHandle(rows, session, id, sendOutcome),
    message,
    landed: () => rows.wait("receipt.landed", { session, receipt: id }),
  };
}

export function runHandle(rows: Rows, session: SessionId, id: RunId): Run {
  return {
    id,
    stop: () => rows.call("run.stop", { session, run: id }),
    settled: (options) => rows.wait("run.settled", { session, run: id }, options),
  };
}

export function sendOutcome(value: Json): SendOutcome {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "withdrawn")
    return { kind: "withdrawn" };
  const end = parsed(RunEndSchema, value);

  if (end !== null) return end;
  const moved = parsed(MoveOutcomeSchema, value);

  return moved !== null && moved.kind !== "moved" ? moved : unreadable("send");
}

export function moveOutcome(value: Json): MoveOutcome {
  return parsed(MoveOutcomeSchema, value) ?? unreadable("move");
}

export function batchOutcome(value: Json): BatchOutcome {
  return parsed(BatchOutcomeSchema, value) ?? unreadable("batch");
}

export function parsed<T>(schema: Schema<T>, value: unknown): T | null {
  const result = schema["~standard"].validate(value);

  return result instanceof Promise || result.issues !== undefined ? null : result.value;
}

function unreadable(what: string): never {
  throw new SdkError("invalid", `The host answered a ${what} outcome the sdk cannot read.`);
}
