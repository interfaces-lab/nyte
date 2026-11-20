import type { Message, SessionId, UserContent } from "@nyte-ai/sdk";
import type { RefusedSend } from "@nyte-ai/sdk/client";
import type { SendOutcome } from "./remote-chat.ts";

export type SendAnswer =
  | { readonly kind: "sent"; readonly message: Message["id"] }
  | { readonly kind: "unsent" }
  | { readonly kind: "removed" }
  | { readonly kind: "refused"; readonly error: string };

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

export async function askToMerge(
  send: () => Promise<SendOutcome>,
  refused: () => void,
): Promise<{ readonly kind: "back" } | { readonly kind: "failed"; readonly error: string } | null> {
  const outcome = await send();

  if (outcome.kind === "ignored") return null;

  if (outcome.kind === "failed") return outcome;
  void outcome.answer.then((answer) => {
    if (answer.kind === "refused") refused();
  });

  return { kind: "back" };
}

export function returnedDraft(current: string, sent: string): string {
  return current.trim() === "" ? sent : `${sent}\n\n${current}`;
}

export function sentText(content: UserContent): string {
  if (typeof content === "string") return content;
  const first = content[0];

  return first?.kind === "text" ? first.text : "";
}

export interface DraftTexts {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function draftKey(scope: string, session: SessionId | undefined): string {
  return JSON.stringify([scope, session ?? "new"]);
}

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
