import type { Message, SessionId, UserContent } from "@nyte-ai/sdk";
import type { RefusedSend } from "@nyte-ai/sdk/client";

/**
 * How a send the journal holds ends for the composer: `sent` once the host has it, `unsent` while
 * the journal keeps it for the next connection to that host or for a resend, `removed` when its
 * unsent row was withdrawn, and `refused` when the host refused it, the one end that gives the text
 * back.
 */
export type SendAnswer =
  | { readonly kind: "sent"; readonly message: Message["id"] }
  | { readonly kind: "unsent" }
  | { readonly kind: "removed" }
  | { readonly kind: "refused"; readonly error: string };

/** What `sendAnswer` reads of a chat's `delivered`. */
type Delivered =
  | { readonly kind: "sent"; readonly receipt: { readonly message: Message["id"] } }
  | { readonly kind: "unsent" }
  | { readonly kind: "removed" };

export function sendAnswer(
  delivered: Promise<Delivered>,
  describe: (cause: unknown) => string,
): Promise<SendAnswer> {
  return delivered.then(
    (end): SendAnswer =>
      end.kind === "sent" ? { kind: "sent", message: end.receipt.message } : { kind: end.kind },
    (cause: unknown): SendAnswer => ({ kind: "refused", error: describe(cause) }),
  );
}

/** The draft a refused send leaves: its text alone in an empty draft, else in front of the person's own. */
export function returnedDraft(current: string, sent: string): string {
  return current.trim() === "" ? sent : `${sent}\n\n${current}`;
}

/** The person's text in what the phone sent: its first text part, as a start's draft reads it. */
export function sentText(content: UserContent): string {
  if (typeof content === "string") return content;
  const first = content[0];

  return first?.kind === "text" ? first.text : "";
}

/** The chat drafts the phone keeps, one text per key. */
export interface DraftTexts {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function draftKey(scope: string, session: SessionId | undefined): string {
  return JSON.stringify([scope, session ?? "new"]);
}

/** Gives each replayed send the host refused back to its chat's stored draft, as a live refusal is given back to the composer. */
export function returnRefused(
  drafts: DraftTexts,
  scope: string,
  refused: readonly RefusedSend[],
): void {
  for (const send of refused) {
    const key = draftKey(scope, send.session);
    drafts.set(key, returnedDraft(drafts.getString(key) ?? "", sentText(send.content)));
  }
}
