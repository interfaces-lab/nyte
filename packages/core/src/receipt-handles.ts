import { asId } from "@nyte-ai/schema";
import type {
  Disposer,
  HeadName,
  Json,
  MessageId,
  MoveOutcome,
  ReceiptId,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { LOCAL } from "./principals.ts";
import type { Receipt, SendReceipt } from "./receipt.ts";
import { settleReceipt } from "./receipts.ts";
import { inboxRef } from "./refs.ts";
import { stopRun } from "./runs.ts";
import {
  STALE,
  attempt,
  commit,
  expectOf,
  isJsonObject,
  put,
  readInbox,
  readReceipt,
  withFold,
} from "./session-state.ts";
import { onReceipt, waitFor } from "./waits.ts";

/** Returns what a send receipt settles with. */
export type SendOutcome = Awaited<ReturnType<SendReceipt["settled"]>>;

/** Returns what a send receipt's `landed()` resolves with. */
export type Landing = Awaited<ReturnType<SendReceipt["landed"]>>;

const SEND_OUTCOMES: ReadonlySet<string> = new Set([
  "completed",
  "stopped",
  "failed",
  "withdrawn",
  "stale",
  "busy",
  "pending-input",
  "missing-target",
  "summary-failed",
]);

const MOVE_FAILURES: ReadonlySet<string> = new Set([
  "stale",
  "busy",
  "pending-input",
  "missing-target",
  "summary-failed",
]);

const RECEIPT_EVENTS: ReadonlySet<string> = new Set(["input", "run", "head"]);

/** Returns a receipt whose stored outcome is checked to be `O`: status from its ref, settlement from in-process settles and session events, stop by its kind. */
export function typedReceipt<O extends Json>(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  is: (value: Json) => value is O,
): Receipt<O> {
  const outcomeOf = (value: Json): O => {
    if (!is(value))
      throw new SdkError("internal", `Receipt ${id} holds another command's outcome.`);

    return value;
  };

  return {
    id,
    async status() {
      const found = await readReceipt(kernel, session, id);

      if (found === null) return { kind: "missing" };
      const outcome = found.record.outcome;

      return outcome === null
        ? { kind: "pending" }
        : { kind: "settled", outcome: outcomeOf(outcome) };
    },
    settled: (options) =>
      waitFor({
        options,
        async check() {
          const found = await readReceipt(kernel, session, id);

          if (found === null) throw new SdkError("unknown", `No receipt has the id ${id}.`);
          const outcome = found.record.outcome;

          return outcome === null ? null : { value: outcomeOf(outcome) };
        },
        subscribe: (trigger) =>
          both(
            onReceipt(kernel, session, id, trigger),
            kernel.bus.subscribe(session, (event) => {
              if (RECEIPT_EVENTS.has(event.kind)) trigger();
            }),
          ),
      }),
    stop: () => stopReceipt(kernel, session, id, outcomeOf),
  };
}

/** Waits until a sent message lands, is withdrawn, or its edit settles with a move failure. */
export async function landed(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  message: MessageId,
): Promise<Landing> {
  const hold = kernel.folds.acquire(session, LOCAL);

  try {
    await hold.ready();

    return await waitFor<Landing>({
      async check() {
        const current = hold.state().messages.get(message);

        if (current?.kind === "user" && current.status.kind === "landed")
          return { value: current.status };
        const found = await readReceipt(kernel, session, id);

        if (found === null) throw new SdkError("unknown", `No receipt has the id ${id}.`);
        const outcome = found.record.outcome;

        return outcome !== null && (isWithdrawn(outcome) || isMoveFailure(outcome))
          ? { value: outcome }
          : null;
      },
      subscribe: (trigger) =>
        both(
          hold.subscribe(() => trigger()),
          onReceipt(kernel, session, id, trigger),
        ),
    });
  } finally {
    hold.release();
  }
}

/** Withdraws pending inputs from a head's inbox with one `input withdrawn` each, settles their receipts `withdrawn`, and returns the ones it found. */
export async function withdraw(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  ids: readonly MessageId[],
): Promise<readonly MessageId[]> {
  const withdrawn = await attempt("Withdrawing inputs", async () => {
    const inbox = await readInbox(kernel, session, head);
    const due = inbox.messages.filter((message) => ids.includes(message));

    if (due.length === 0) return [];

    const target = await put(kernel, "inbox", {
      messages: inbox.messages.filter((message) => !due.includes(message)),
    });

    const outcome = await commit(
      kernel,
      due.map((message, index) => ({
        name: inboxRef(session, head),
        target,
        expect: index === 0 ? expectOf(inbox.ref) : undefined,
        event: { head, kind: "input", message, change: "withdrawn" },
      })),
    );

    return outcome.kind === "set" ? due : STALE;
  });

  for (const message of withdrawn)
    await settleReceipt(kernel, session, asId<"receipt">(message), { kind: "withdrawn" });

  return withdrawn;
}

/** Returns whether a stored outcome is one a send receipt settles with. */
export function isSendOutcome(value: Json): value is SendOutcome {
  return isJsonObject(value) && typeof value.kind === "string" && SEND_OUTCOMES.has(value.kind);
}

/** Returns whether a stored outcome is a move's. */
export function isMoveOutcome(value: Json): value is MoveOutcome {
  return (
    isJsonObject(value) &&
    typeof value.kind === "string" &&
    (value.kind === "moved" || MOVE_FAILURES.has(value.kind))
  );
}

/** Returns whether a stored outcome is any value. */
export function isAnyOutcome(_value: Json): _value is Json {
  return true;
}

async function stopReceipt<O extends Json>(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  outcomeOf: (value: Json) => O,
): Promise<StopOutcome<O>> {
  const found = await readReceipt(kernel, session, id);

  if (found === null) return { kind: "missing" };

  if (found.record.outcome !== null)
    return { kind: "settled", outcome: outcomeOf(found.record.outcome) };

  if (found.record.kind !== "send") return { kind: "requested" };
  const message = asId<"message">(id);
  const input = await withFold(kernel, session, (state) => state.inputs.get(message));

  if (input === undefined) return { kind: "missing" };

  if (input.landed === null && (await withdraw(kernel, session, input.head, [message])).length > 0)
    return { kind: "requested" };

  const run =
    input.landed?.run ??
    (await withFold(kernel, session, (state) => state.inputs.get(message)?.landed?.run)) ??
    null;

  if (run === null) return { kind: "missing" };
  const stopped = await stopRun(kernel, session, run);

  return stopped.kind === "settled"
    ? { kind: "settled", outcome: outcomeOf(stopped.outcome) }
    : stopped;
}

function isWithdrawn(value: Json): value is { readonly kind: "withdrawn" } {
  return isJsonObject(value) && value.kind === "withdrawn";
}

function isMoveFailure(value: Json): value is Exclude<MoveOutcome, { readonly kind: "moved" }> {
  return isJsonObject(value) && typeof value.kind === "string" && MOVE_FAILURES.has(value.kind);
}

function both(left: Disposer, right: Disposer): Disposer {
  return () => {
    left();
    right();
  };
}
