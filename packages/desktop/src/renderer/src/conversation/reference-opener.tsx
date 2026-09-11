import { createContext, useContext } from "react";
import type { MessageReference } from "./message-references.ts";

/**
 * Resolves a chip to the action that opens what it stands for, or `undefined`
 * when nothing can open it on this surface. Chips without an action draw as
 * plain labels.
 */
export type ReferenceOpener = (reference: MessageReference) => (() => void) | undefined;

const ReferenceOpenerContext = createContext<ReferenceOpener | undefined>(undefined);

export const ReferenceOpenerProvider = ReferenceOpenerContext.Provider;

export function useReferenceOpener(): ReferenceOpener | undefined {
  return useContext(ReferenceOpenerContext);
}
