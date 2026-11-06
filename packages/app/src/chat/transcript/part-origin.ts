import { createContext } from "react";
import type { PartId, SessionId } from "@nyte-ai/sdk";

export const PartOrigin = createContext<
  { readonly sessionId: SessionId; readonly part: PartId } | undefined
>(undefined);
