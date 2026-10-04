import type { ComponentProps } from "react";
import type { StatusDot } from "@nyte-ai/app/components/ui.tsx";

export type ChatMark = ComponentProps<typeof StatusDot>["mark"];

export interface Chat {
  readonly id: string;
  readonly title: string;
  readonly folder: string;
  readonly mark: ChatMark;
  readonly elapsed: string;
  readonly ask?: string;
  readonly prompt: string;
  readonly steps: string;
  readonly reply: string;
  /** The pull request this chat opened. Its card in the transcript leads to the review page. */
  readonly reviewId?: string;
}

export interface DiffLine {
  readonly kind: "add" | "remove" | "context";
  readonly text: string;
}

export interface ReviewFile {
  readonly path: string;
  readonly lines: readonly DiffLine[];
}

export interface Review {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly folder: string;
  readonly author: string;
  readonly base: string;
  readonly branch: string;
  readonly summary: readonly string[];
  readonly files: readonly ReviewFile[];
}

export const CHATS: readonly Chat[] = [
  {
    id: "c-drag",
    title: "Restore window dragging above scrolled documents",
    folder: "nyte",
    mark: "idle",
    elapsed: "12m",
    prompt: "The tab bar stops dragging the window once a document scrolls. Fix it.",
    steps: "Read 4 files, edited 2",
    reply: "Fixed and pushed. The scroll viewport now resets the drag region on its descendants.",
    reviewId: "r-482",
  },
  {
    id: "c-pairing",
    title: "Confirm pairing copy",
    folder: "nyte",
    mark: "waiting",
    elapsed: "1m",
    ask: "Asked which wording to keep",
    prompt: "Tighten the pairing screen copy.",
    steps: "Read 3 files",
    reply: "Two wordings fit the pairing screen. Which one should stay?",
  },
  {
    id: "c-e2e",
    title: "Run e2e remote-access suite",
    folder: "nyte",
    mark: "working",
    elapsed: "6m",
    prompt: "Run the remote-access e2e suite and fix what fails.",
    steps: "Ran 2 commands",
    reply: "",
  },
  {
    id: "c-retry",
    title: "Payments retry backoff",
    folder: "api",
    mark: "failed",
    elapsed: "5h",
    ask: "Typecheck failed in retry.ts",
    prompt: "Add exponential backoff to the payment retries.",
    steps: "Edited 1 file, ran typecheck",
    reply: "Typecheck failed in retry.ts.",
  },
  {
    id: "c-shadow",
    title: "Split popover shadow tiers",
    folder: "nyte",
    mark: "idle",
    elapsed: "40m",
    prompt: "Split the popover shadow into two tiers.",
    steps: "Read 6 files, edited 3",
    reply: "Done. Menus use the near tier, dialogs the far one.",
    reviewId: "r-479",
  },
  {
    id: "c-notes",
    title: "Draft release notes",
    folder: "Home",
    mark: "idle",
    elapsed: "3h",
    prompt: "Draft release notes for 0.42.",
    steps: "Read the changelog",
    reply: "Draft is in RELEASE.md.",
  },
];

export const REVIEWS: readonly Review[] = [
  {
    id: "r-482",
    number: 482,
    title: "Restore window dragging above scrolled documents",
    folder: "nyte",
    author: "nyte",
    base: "main",
    branch: "nyte/tab-bar-drag-handle",
    summary: [
      "Reset Electron's drag-region state on clipped descendants while keeping the scroll viewport non-draggable.",
      "Dragging from the empty tab bar works again when a document is scrolled.",
    ],
    files: [
      {
        path: "packages/app/src/shell/document-view.tsx",
        lines: [
          { kind: "context", text: 'import { ScrollArea } from "@nyte-ai/ui/scroll-area";' },
          { kind: "add", text: 'import dragStyles from "./document-view.module.css";' },
          { kind: "context", text: "" },
          { kind: "context", text: "<ScrollArea" },
          { kind: "remove", text: "  className={styles.scrollable}" },
          { kind: "add", text: "  className={dragStyles.scrollable}" },
          { kind: "context", text: '  gutter="stable both-edges"' },
        ],
      },
      {
        path: "packages/app/src/shell/document-view.module.css",
        lines: [
          { kind: "add", text: ":where(.scrollable *) {" },
          { kind: "add", text: "  -webkit-app-region: initial;" },
          { kind: "add", text: "}" },
        ],
      },
    ],
  },
  {
    id: "r-479",
    number: 479,
    title: "Split popover shadow tiers",
    folder: "nyte",
    author: "nyte",
    base: "main",
    branch: "nyte/popover-shadow-tiers",
    summary: ["Menus take the near shadow and dialogs the far one, so stacked popups separate."],
    files: [
      {
        path: "packages/ui/src/floating-surface.stylex.ts",
        lines: [
          { kind: "remove", text: "boxShadow: shadow.shadowLg," },
          { kind: "add", text: "boxShadow: near ? shadow.shadowMd : shadow.shadowXl," },
        ],
      },
    ],
  },
];

export function chatById(id: string): Chat | undefined {
  return CHATS.find((chat) => chat.id === id);
}

export function reviewById(id: string): Review | undefined {
  return REVIEWS.find((review) => review.id === id);
}

/** Needs you, then running, then finished: the production sidebar's status ranking. */
const RANK = {
  waiting: 0,
  failed: 0,
  retry: 1,
  working: 1,
  idle: 2,
} as const satisfies Readonly<Record<ChatMark, number>>;

export const SIDEBAR_CHATS = CHATS.toSorted((left, right) => RANK[left.mark] - RANK[right.mark]);
