import type {
  Delivery,
  HeadName,
  MessageId,
  MessageSource,
  ReceiptId,
  RefUpdate,
  RunId,
  Schedule,
  SessionId,
  Submission,
  UserContent,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { StoreConnection } from "../contract/store.ts";
import { inboxRef, receiptRef } from "../store/refs.ts";
import { inboxWithout, put, readRefExpectation } from "../store/session.ts";
import type { Inbox } from "../store/session.ts";

export interface MessageRecord {
  readonly id: MessageId;
  readonly at: number;
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly schedule: Schedule;
  readonly covered: boolean;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  readonly position: number;
}

export function buildMessage(
  id: MessageId,
  submission: Submission,
  placed: Omit<MessageRecord, "id" | "at" | "content" | "source" | "delivery">,
): MessageRecord {
  return {
    id,
    at: Date.now(),
    content: submission.content,
    source: submission.source,
    delivery: submission.delivery,
    ...placed,
  };
}

export async function admitted(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  inbox: Inbox,
  messages: readonly MessageId[],
  message: MessageRecord,
): Promise<RefUpdate> {
  const input = message.source.kind === "user" && message.delivery !== "attach";

  const pendingInput = [
    ...inbox.pendingInput.filter((id) => id !== message.id),
    ...(input ? [message.id] : []),
  ];

  return {
    name: inboxRef(session, head),
    target: await put(kernel.store, "inbox", {
      ...inboxWithout(inbox, []),
      messages,
      pendingInput,
    }),
    expect: readRefExpectation(inbox.ref),
    events: [
      {
        head,
        kind: "input",
        message: message.id,
        change: "admitted",
        content: message.content,
        source: message.source,
        delivery: message.delivery,
        schedule: message.schedule,
        covered: message.covered,
        replaced: message.replaced,
        requires: [...(kernel.presence?.member.capabilities ?? [])],
      },
    ],
  };
}

export async function pendingReceipt(
  store: StoreConnection,
  session: SessionId,
  id: ReceiptId,
  digest: string,
  expect: RefUpdate["expect"],
): Promise<RefUpdate> {
  return {
    name: receiptRef(session, id),
    target: await put(store, "receipt", { id, kind: "send", digest, outcome: null }),
    expect,
  };
}
