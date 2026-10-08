/**
 * The strip's contents. Three kinds, in the order Dia and Arc keep them: pinned
 * places, folders, then the chats you opened this session. Every status the
 * desktop can report is in the set, so each indication can be checked at once.
 */
import type { SessionMark } from "@nyte-ai/client";
import type { IconName } from "@nyte-ai/ui/icon";

export type TabKind = "pinned" | "folder" | "chat";

export interface ShellTab {
  readonly id: string;
  readonly kind: TabKind;
  readonly title: string;
  /** The place's own icon; status may replace or badge it. */
  readonly icon: IconName;
  readonly mark: SessionMark;
  /** A chat in a background tab finished since it was last seen. */
  readonly unread: boolean;
  readonly split?: "right" | "down";
  /** Folders: agents running inside. */
  readonly count?: number;
}

export const SPACE = "nyte";

export const TABS: readonly ShellTab[] = [
  {
    id: "customize",
    kind: "pinned",
    title: "Customize",
    icon: "customize",
    mark: "idle",
    unread: false,
  },
  {
    id: "environments",
    kind: "pinned",
    title: "Environments",
    icon: "server",
    mark: "idle",
    unread: false,
  },
  {
    id: "inbox",
    kind: "pinned",
    title: "Needs you",
    icon: "inbox-empty",
    mark: "waiting",
    unread: false,
  },
  {
    id: "dialogs",
    kind: "folder",
    title: "Dialog surface migration",
    icon: "folder",
    mark: "working",
    unread: false,
    count: 3,
  },
  {
    id: "tabs-project",
    kind: "folder",
    title: "Window tabs",
    icon: "folder",
    mark: "idle",
    unread: true,
    count: 1,
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
  { id: "new", kind: "chat", title: "New chat", icon: "new-chat", mark: "idle", unread: false },
];

/** Opened by ⌘T; the strip cycles through these titles. */
export const DRAFTS = [
  "Split the popover shadow by tier",
  "Rename the Changes tab",
  "Check the sidebar handle on Windows",
  "Why does the composer lose focus on split",
] as const;
