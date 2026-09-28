import { createContext, useContext } from "react";
import type { MessageReference } from "./message-references.ts";

/** A chip's reference, or a link in conversation text. */
export type OpenableReference = MessageReference | { readonly kind: "url"; readonly url: string };

/**
 * Resolves a chip or link to the action that opens what it stands for, or
 * `undefined` when nothing can open it on this surface. Chips without an
 * action draw as plain labels.
 */
export type ReferenceOpener = (reference: OpenableReference) => (() => void) | undefined;

const ReferenceOpenerContext = createContext<ReferenceOpener | undefined>(undefined);

export const ReferenceOpenerProvider = ReferenceOpenerContext.Provider;

export function useReferenceOpener(): ReferenceOpener | undefined {
  return useContext(ReferenceOpenerContext);
}
