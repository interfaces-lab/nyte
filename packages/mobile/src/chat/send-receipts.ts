import { randomUUID } from "expo-crypto";
import { createMMKV } from "react-native-mmkv";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { sessionId, type Delivery, type OperationInput, type SessionId } from "@nyte-ai/protocol";

const receipts = createMMKV({ id: "nyte.send-receipts" });

const MessageReceipt = Type.Object(
  {
    serialized: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    draft: Type.Optional(Type.String()),
    delivery: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("next")])),
  },
  { additionalProperties: false },
);

const NewConversationReceipt = Type.Object(
  { id: Type.String({ minLength: 1 }), workspace: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type SendReceipt = Static<typeof MessageReceipt>;

function readStored<Schema extends TSchema>(
  key: string,
  schema: Schema,
): Static<Schema> | undefined {
  const text = receipts.getString(key);

  if (text === undefined) return undefined;

  try {
    const value: unknown = JSON.parse(text);

    if (Value.Check(schema, value)) return value;
  } catch {
    receipts.remove(key);

    return undefined;
  }

  receipts.remove(key);

  return undefined;
}

export function prepareMessageReceipt({
  scope,
  sessionId,
  content,
  delivery,
  draft,
}: {
  scope: string;
  sessionId: SessionId;
  content: OperationInput<"messages.send">["content"];
  delivery?: Delivery;
  draft?: string;
}): SendReceipt {
  const storageKey = JSON.stringify([scope, "message", sessionId]);
  const stored = readStored(storageKey, MessageReceipt);
  const serialized = JSON.stringify(content);

  const receipt =
    stored?.serialized === serialized ? stored : { serialized, key: randomUUID(), delivery };

  const next = draft === undefined ? receipt : { ...receipt, draft };
  receipts.set(storageKey, JSON.stringify(next));

  return next;
}

export function finishMessageReceipt({
  scope,
  sessionId,
  key,
}: {
  scope: string;
  sessionId: SessionId;
  key: string;
}): void {
  const storageKey = JSON.stringify([scope, "message", sessionId]);
  const stored = readStored(storageKey, MessageReceipt);

  if (stored?.key === key) receipts.remove(storageKey);
}

export function readMessageDelivery({
  scope,
  sessionId,
}: {
  scope: string;
  sessionId: SessionId;
}): Delivery | undefined {
  return readStored(JSON.stringify([scope, "message", sessionId]), MessageReceipt)?.delivery;
}

export function discardMessageReceipt({
  scope,
  sessionId,
}: {
  scope: string;
  sessionId: SessionId;
}): void {
  receipts.remove(JSON.stringify([scope, "message", sessionId]));
}

export function prepareNewConversation({ scope, workspace }: { scope: string; workspace: string }) {
  const storageKey = JSON.stringify([scope, "new"]);
  const stored = readStored(storageKey, NewConversationReceipt);

  // A pending chat keeps its id across a folder change: its session may exist
  // already, and a new id would start a second chat with the same message.
  if (stored !== undefined) return sessionId(stored.id);

  const id = sessionId(randomUUID());
  receipts.set(storageKey, JSON.stringify({ id, workspace }));

  return id;
}

export function finishNewConversation({ scope, id }: { scope: string; id: SessionId }): void {
  const storageKey = JSON.stringify([scope, "new"]);
  const stored = readStored(storageKey, NewConversationReceipt);

  if (stored?.id === id) receipts.remove(storageKey);
}
