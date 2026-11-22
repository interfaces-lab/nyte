import type { ReactNode } from "react";
import type { PaneId, PaneTabId } from "./layout.ts";
import type { PaneContent, PaneKindName } from "./pane-kinds.ts";

export interface PaneTabRender<Fields> {
  readonly tab: PaneTabId;
  readonly pane: PaneId;
  readonly fields: Fields;
  readonly visible: boolean;
  readonly focused: boolean;
}

export type PaneView<Fields> = (input: PaneTabRender<Fields>) => ReactNode;

export interface PaneTabInput<K extends PaneKindName = PaneKindName> {
  readonly tab: PaneTabId;
  readonly pane: PaneId;
  readonly content: PaneContent<K>;
  readonly visible: boolean;
  readonly focused: boolean;
}
