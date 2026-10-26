import type { ReactElement } from "react";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import type { IconName } from "@nyte-ai/ui/icon";
import type { SplitDirection } from "../layout/pane-layout.ts";
import type { PinnedPlace } from "./strip.ts";

export interface PinnedItem {
  readonly place: PinnedPlace;
  readonly title: string;
  readonly icon: IconName;
  readonly mark: SessionMark;
}

export interface ChatTabItem {
  readonly key: string;
  readonly title: string;
  readonly icon: IconName;
  readonly mark: SessionMark;
  readonly unread: boolean;
  readonly split: SplitDirection | undefined;
  /** Drawn in italics until kept, as the replaceable slot. */
  readonly preview: boolean;
}

export interface ChatTabStripProps {
  readonly pinned: readonly PinnedItem[];
  readonly tabs: readonly ChatTabItem[];
  /** A pinned place or a tab key. */
  readonly active: string | undefined;
  readonly closed: readonly { readonly key: string; readonly title: string }[];
  readonly mac: boolean;
  readonly onSelect: (key: string) => void;
  readonly onKeep: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly onCloseOthers: (key: string) => void;
  readonly onCloseRight: (key: string) => void;
  readonly onReorder: (keys: readonly string[]) => void;
  readonly onReopen: () => void;
  readonly onNew: () => void;
}

/**
 * The lab's proposal strip (packages/lab/src/tabs/strip.tsx) with its design fixed: the active
 * tab joins the card, others are chips, close sits beside the active tab, status is a badge on
 * the icon, chat tabs shrink to icons, pinned places are icons. Keeps the shipped strip's drag
 * reorder and context menu, and adds the trailing "All tabs" menu with Reopen.
 */
export function ChatTabStrip(strip: ChatTabStripProps): ReactElement {
  void strip;
  throw new Error("not implemented");
}
