/**
 * New chats on a registry host. The host exposes folders by opaque id and
 * starts a root with its first message durably under the caller's request id.
 * Which folder this phone works in is the phone's own state, kept per host
 * and principal; nothing here moves a cursor another client could see.
 *
 * A start is written down whole before it is sent: request id, folder, model,
 * thinking level and message. Every later attempt sends that record, never
 * the composer, so a retry, a relaunch or a folder change asks the host about
 * exactly what was first sent and cannot make a second chat. One start waits
 * per scope; a newer one is refused until the first is opened or edited.
 *
 * Storage is the boundary: the app passes MMKV, a Node smoke passes a map.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { StartInputSchema, StartReceiptSchema } from "@nyte-ai/protocol";
import type { RegisteredWorkspace, SessionId, StartInput, StartReceipt } from "@nyte-ai/protocol";
import type { NyteClient } from "@nyte-ai/client";

export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
}

export function selectionKey(scope: string): string {
  return JSON.stringify([scope, "workspace"]);
}

export function startKey(scope: string): string {
  return JSON.stringify([scope, "start"]);
}

/** A folder the host serves right now; the rest wait on the owner. */
export function isReady(row: RegisteredWorkspace): boolean {
  return row.trust.kind === "granted" || row.trust.kind === "policy";
}

/** The folder new chats go to: the one chosen here while it is ready, else the only ready one. */
export function selectedFolder(
  rows: readonly RegisteredWorkspace[],
  chosenId: string | undefined,
): RegisteredWorkspace | undefined {
  const ready = rows.filter(isReady);
  const chosen = ready.find((row) => row.id === chosenId);

  if (chosen !== undefined) return chosen;

  return ready.length === 1 ? ready[0] : undefined;
}

const PendingStartSchema = Type.Object(
  {
    input: StartInputSchema,
    /** The host's answer, kept until this phone acts on it; absent while unanswered. */
    receipt: Type.Optional(StartReceiptSchema),
  },
  { additionalProperties: false },
);

export type PendingStart = Static<typeof PendingStartSchema>;

export function readPendingStart(
  storage: KeyValueStorage,
  scope: string,
): PendingStart | undefined {
  return parsePendingStart(storage.getString(startKey(scope)));
}

export function parsePendingStart(text: string | undefined): PendingStart | undefined {
  if (text === undefined) return undefined;

  try {
    const value: unknown = JSON.parse(text);

    return Value.Check(PendingStartSchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * On record before the first attempt. A start already waiting stays; the
 * caller gets it back and must not send the new input.
 */
export function recordStart(
  storage: KeyValueStorage,
  scope: string,
  input: StartInput,
): { kind: "recorded"; pending: PendingStart } | { kind: "waiting"; pending: PendingStart } {
  const existing = readPendingStart(storage, scope);

  if (existing !== undefined) return { kind: "waiting", pending: existing };
  const recorded: PendingStart = { input };
  storage.set(startKey(scope), JSON.stringify(recorded));

  return { kind: "recorded", pending: recorded };
}

/** Removes the record only while it is still this request; a newer one stays. */
export function removeStart(storage: KeyValueStorage, scope: string, requestId: string): void {
  if (readPendingStart(storage, scope)?.input.requestId === requestId)
    storage.remove(startKey(scope));
}

export type StartOutcome =
  | { kind: "accepted"; sessionId: SessionId }
  | { kind: "refused"; message: string }
  /** No answer came. The host may have the chat; the record stays for a retry. */
  | { kind: "unanswered"; cause: unknown }
  /** This request is being asked about already. */
  | { kind: "asking" };

const asking = new Set<string>();

const listeners = new Set<() => void>();

function flightKey(scope: string, requestId: string): string {
  return JSON.stringify([scope, requestId]);
}

function setAsking(flight: string, active: boolean): void {
  if (active) asking.add(flight);
  else asking.delete(flight);

  for (const listener of listeners) listener();
}

export function subscribeAsking(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function isAsking(scope: string, requestId: string): boolean {
  return asking.has(flightKey(scope, requestId));
}

/**
 * Ask the host about the recorded start, exactly as recorded. The answer goes
 * on the record and stays there until the screen that shows it acts on it:
 * an accepted chat until it is opened, a refusal until it is edited.
 */
export async function askStart({
  client,
  storage,
  scope,
  input,
}: {
  client: Pick<NyteClient, "environment">;
  storage: KeyValueStorage;
  scope: string;
  input: StartInput;
}): Promise<StartOutcome> {
  const flight = flightKey(scope, input.requestId);

  if (asking.has(flight)) return { kind: "asking" };
  setAsking(flight, true);

  try {
    let receipt: StartReceipt;

    try {
      receipt = await client.environment("environment.start", input);
    } catch (cause: unknown) {
      return { kind: "unanswered", cause };
    }

    const stored = readPendingStart(storage, scope);

    if (stored?.input.requestId === input.requestId)
      storage.set(startKey(scope), JSON.stringify({ ...stored, receipt }));

    return receipt.kind === "accepted"
      ? { kind: "accepted", sessionId: receipt.sessionId }
      : { kind: "refused", message: refusalMessage(receipt) };
  } finally {
    setAsking(flight, false);
  }
}

/** Whether asking the same request again can change the answer. */
export function canRetry(pending: PendingStart): boolean {
  const receipt = pending.receipt;

  if (receipt === undefined) return true;

  return receipt.kind === "refused" && receipt.reason !== "deleted";
}

/** Whether Edit can give the message back without risking a second chat. */
export function canEdit(pending: PendingStart): boolean {
  return pending.receipt?.kind !== "accepted";
}

export function refusalMessage(receipt: Exclude<StartReceipt, { kind: "accepted" }>): string {
  if (receipt.kind === "conflict") return "This message was already sent with other content.";

  switch (receipt.reason) {
    case "workspace_unknown":
      return "This folder is no longer on the host.";
    case "workspace_untrusted":
      return "The host owner needs to trust this folder.";
    case "workspace_unavailable":
      return "This folder isn't available on the host right now.";
    case "model_unknown":
      return "The host doesn't offer that model.";
    case "deleted":
      return "This chat was deleted.";
    default: {
      const exhaustive: never = receipt.reason;

      return exhaustive;
    }
  }
}

/** The message's parts; a plain string is one text part. */
export function startParts(input: StartInput) {
  const content = input.message.content;

  return Array.isArray(content) ? content : [{ type: "text" as const, text: content }];
}

/** The typed text a start leads with: the composer puts it first, before photos and notes. */
export function startText(input: StartInput): string {
  const first = startParts(input)[0];

  return first?.type === "text" ? first.text : "";
}

/** The message's first line, short enough for one caption. */
export function startPreview(input: StartInput): string {
  const line = startText(input).trim().split("\n", 1)[0] ?? "";

  if (line !== "") return line.length > 60 ? `${line.slice(0, 59)}…` : line;

  return startParts(input).some((part) => part.type === "image") ? "Photo" : "Message";
}
