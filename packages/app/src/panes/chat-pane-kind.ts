import { Value } from "typebox/value";
import type { PaneKind } from "./pane-kind.ts";
import { paneSelectionSchema } from "./pane-layout.ts";
import type { PaneSelection } from "./pane-layout.ts";

export interface ChatFields {
  readonly selection: PaneSelection;
}

export const chatKind: PaneKind<ChatFields> = {
  identity: (fields) =>
    fields.selection.kind === "session" ? fields.selection.sessionId : undefined,
  restore: (stored) =>
    Value.Check(paneSelectionSchema, stored) ? { selection: stored } : undefined,
  persist: (fields) => fields.selection,
};
