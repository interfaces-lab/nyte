import type { ReactNode } from "react";
import { chatView } from "../chat/chat-pane-view.tsx";
import type { PaneFieldsMap, PaneKindName } from "../panes/pane-kinds.ts";
import type { PaneTabInput, PaneView } from "../panes/pane-view.ts";

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
