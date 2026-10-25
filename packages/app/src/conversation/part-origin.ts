import { createContext } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";

/** The chat and part a plugin renderer is drawing, which its renderer's arguments do not carry. */
export const PartOrigin = createContext<
  { readonly sessionId: SessionId; readonly part: PartId } | undefined
>(undefined);
