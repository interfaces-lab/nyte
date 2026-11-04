import { Value } from "typebox/value";
import type { PaneKind } from "../panes/pane-kind.ts";
import { paneSelectionSchema } from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";

export interface ChatFields {
  readonly selection: PaneSelection;
}

/** A pane shows one chat: opening another chat in it replaces it. */
export const chatKind: PaneKind<ChatFields> = {
  identity: (fields) =>
    fields.selection.kind === "session" ? fields.selection.sessionId : undefined,
  replaceable: () => true,
  mount: "while-active",
  restore: (stored) =>
    Value.Check(paneSelectionSchema, stored) ? { selection: stored } : undefined,
  persist: (fields) => fields.selection,
};
