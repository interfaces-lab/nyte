import type { ReactNode } from "react";
import { chatView } from "../chat/chat-pane-view.tsx";
import type { PaneId, PaneTabId } from "./layout.ts";
import type { PaneContent, PaneFieldsMap, PaneKindName } from "./pane-kinds.ts";

export interface PaneTabRender<Fields> {
  readonly tab: PaneTabId;
  readonly pane: PaneId;
  readonly fields: Fields;
  /** In view: its pane's active tab, not hidden and not under a zoomed pane. */
  readonly visible: boolean;
  readonly focused: boolean;
}

export type PaneView<Fields> = (input: PaneTabRender<Fields>) => ReactNode;

/** A tab to draw, with the content of whichever kind it holds. */
export interface PaneTabInput<K extends PaneKindName = PaneKindName> {
  readonly tab: PaneTabId;
  readonly pane: PaneId;
  readonly content: PaneContent<K>;
  readonly visible: boolean;
  readonly focused: boolean;
}

/** Each kind's view; a kind without one doesn't compile. */
const PANE_VIEWS: { readonly [K in PaneKindName]: PaneView<PaneFieldsMap[K]> } = {
  chat: chatView,
};

export function renderPaneContent<K extends PaneKindName>(input: PaneTabInput<K>): ReactNode {
  return PANE_VIEWS[input.content.kind]({
    tab: input.tab,
    pane: input.pane,
    fields: input.content.fields,
    visible: input.visible,
    focused: input.focused,
  });
}
