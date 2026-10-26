import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import type { IconName } from "@nyte-ai/ui/icon";

/** pinned: always in the strip, never closes. page: a full-tab place opened on demand. */
export type TabKind = "pinned" | "page" | "chat";

export interface ShellTab {
  readonly id: string;
  readonly kind: TabKind;
  readonly title: string;
  readonly icon: IconName;
  readonly mark: SessionMark;
  readonly unread: boolean;
  readonly split?: "right" | "down";
}

export const SPACE = "nyte";

export const INBOX: ShellTab = {
  id: "inbox",
  kind: "pinned",
  title: "Needs you",
  icon: "inbox-empty",
  mark: "waiting",
  unread: false,
};

export const PAGES: readonly ShellTab[] = [
  {
    id: "customize",
    kind: "page",
    title: "Customize",
    icon: "customize",
    mark: "idle",
    unread: false,
  },
  {
    id: "environments",
    kind: "page",
    title: "Environments",
    icon: "server",
    mark: "idle",
    unread: false,
  },
];

export const CHATS: readonly ShellTab[] = [
  {
    id: "dialogs",
    kind: "chat",
    title: "Migrate dialog surfaces",
    icon: "agent",
    mark: "waiting",
    unread: false,
  },
  {
    id: "config",
    kind: "chat",
    title: "Move settings into nyte.json",
    icon: "agent",
    mark: "waiting",
    unread: false,
  },
  {
    id: "shadows",
    kind: "chat",
    title: "Audit floating surface shadows",
    icon: "agent",
    mark: "working",
    unread: false,
  },
  {
    id: "trust",
    kind: "chat",
    title: "Confirm workspace trust copy",
    icon: "agent",
    mark: "waiting",
    unread: false,
  },
  {
    id: "tokens",
    kind: "chat",
    title: "Map translucent tints to nyte tokens",
    icon: "agent",
    mark: "idle",
    unread: true,
    split: "right",
  },
  {
    id: "review",
    kind: "chat",
    title: "Review: titlebar alignment #412",
    icon: "pull-request",
    mark: "idle",
    unread: false,
  },
  {
    id: "titlebar",
    kind: "chat",
    title: "Titlebar controls against the traffic lights",
    icon: "agent",
    mark: "failed",
    unread: false,
  },
];

/** Every pinned tab and chat; the peek board lists the chats from it. */
export const TABS: readonly ShellTab[] = [INBOX, ...CHATS];

export const DRAFTS = [
  "Split the popover shadow by tier",
  "Rename the Changes tab",
  "Check the sidebar handle on Windows",
  "Why does the composer lose focus on split",
] as const;
