import { createContext, useContext } from "react";
import type { MessageReference } from "./message-references.ts";

export type OpenableReference =
  | MessageReference
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "changes"; readonly path: string | null };

export type ReferenceOpener = (reference: OpenableReference) => (() => void) | undefined;

const ReferenceOpenerContext = createContext<ReferenceOpener | undefined>(undefined);

export const ReferenceOpenerProvider = ReferenceOpenerContext.Provider;

export function useReferenceOpener(): ReferenceOpener | undefined {
  return useContext(ReferenceOpenerContext);
}
