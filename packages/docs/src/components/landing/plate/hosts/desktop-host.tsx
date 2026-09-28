import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBlocks,
  IconChevronDownMedium,
  IconChevronDownSmall,
  IconCollaborationPointerRight,
  IconDotGrid1x3VerticalTight,
  IconFolder1,
  IconFolderOpen,
  IconMagnifyingGlass,
  IconPlusSmall,
  IconSettingsGear2,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
  IconUser,
} from "central-icons-desktop";
import { Spinner } from "@nyte-ai/ui";
import type { ReactNode } from "react";
import { Bezel } from "./bezel";
import { EDIT_STATS, editDiffHTML } from "./edit-diff";
import { PrerenderedDiff } from "./prerendered-diff";

type ChatMark = "spinner" | "unread" | "none";

const CHATS = [
  { title: "Migrate stored runs on open", mark: "none", time: "now", selected: true },
  { title: "Stamp tool class on commits", mark: "spinner", time: "2m", selected: false },
  { title: "Unblock desktop release", mark: "unread", time: "1h", selected: false },
  { title: "Preserve tool errors", mark: "none", time: "3h", selected: false },
  { title: "Share one shell across sites", mark: "none", time: "1d", selected: false },
] as const satisfies readonly { title: string; mark: ChatMark; time: string; selected: boolean }[];

function SideRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-(--nyte-text-secondary)">
      <span className="grid w-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function ToolLine({
  verb,
  detail,
  children,
}: {
  verb: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-6 min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-(--nyte-text-secondary)">{verb}</span>
      <span className="min-w-0 truncate text-(--nyte-text-tertiary)">{detail}</span>
      {children}
    </div>
  );
}

/*
 * The desktop app mid-session, measured from packages/desktop: a 35px
 * titlebar over a 220px sidebar, 28px rows, an 840px transcript, and the pill
 * composer. Colours are the app's own (`.desktop-host` in global.css).
 */
export async function DesktopHost() {
  const diff = await editDiffHTML();

  return (
    <Bezel className="h-full">
      <div className="desktop-host flex h-full flex-col overflow-hidden rounded-t-[14px] bg-(--nyte-bg-page) text-left text-(--nyte-text-primary) shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
        <div className="flex h-[35px] shrink-0 border-b border-(--nyte-stroke-secondary)">
          <div className="flex items-center border-r border-(--nyte-stroke-secondary) bg-(--nyte-sidebar) pr-1 text-(--nyte-text-tertiary) md:w-[190px] lg:w-[220px]">
            <div className="flex w-[72px] shrink-0 gap-2 pl-[11px]">
              <span className="size-3 rounded-full bg-(--nyte-text-primary)/15" />
              <span className="size-3 rounded-full bg-(--nyte-text-primary)/15" />
              <span className="size-3 rounded-full bg-(--nyte-text-primary)/15" />
            </div>
            <span className="grid size-7 place-items-center">
              <IconSidebarHiddenLeftWide size={16} />
            </span>
            <span className="grid size-7 place-items-center max-sm:hidden">
              <IconArrowLeft size={16} />
            </span>
            <span className="grid size-7 place-items-center opacity-40 max-sm:hidden">
              <IconArrowRight size={16} />
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-center pr-1 pl-3 text-(--nyte-text-tertiary)">
            <span className="min-w-0 flex-1 truncate text-[12px]/4 text-(--nyte-text-secondary) max-sm:invisible">
              Migrate stored runs on open
            </span>
            <span className="grid size-7 place-items-center">
              <IconDotGrid1x3VerticalTight size={16} />
            </span>
            <span className="grid size-7 place-items-center">
              <IconSidebarHiddenRightWide size={16} />
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[190px] shrink-0 flex-col gap-px border-r border-(--nyte-stroke-secondary) bg-(--nyte-sidebar) p-2 text-[13px]/[18px] md:flex lg:w-[220px]">
            <SideRow icon={<IconCollaborationPointerRight size={14} />}>New Chat</SideRow>
            <SideRow icon={<IconMagnifyingGlass size={14} />}>Search</SideRow>
            <SideRow icon={<IconBlocks size={14} />}>Customize</SideRow>

            <div className="mt-3 flex h-7 items-center px-1 text-(--nyte-text-tertiary)">
              Workspaces
            </div>
            <SideRow icon={<IconFolderOpen size={14} />}>nyte</SideRow>
            {CHATS.map((chat) => (
              <div
                key={chat.title}
                data-selected={chat.selected ? "" : undefined}
                className="group flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-(--nyte-text-secondary) data-selected:bg-(--nyte-fill-selected) data-selected:text-(--nyte-text-primary)"
              >
                <span className="grid w-5 shrink-0 place-items-center">
                  {chat.mark === "spinner" ? (
                    <Spinner
                      className="text-(--nyte-text-accent)"
                      style={{ width: 15, height: 15 }}
                    />
                  ) : null}
                  {chat.mark === "unread" ? (
                    <span className="size-2 rounded-full bg-(--nyte-text-accent)" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="w-10 shrink-0 text-right text-[11px]/[14px] text-(--nyte-text-tertiary) tabular-nums group-data-selected:text-(--nyte-text-secondary)">
                  {chat.time}
                </span>
              </div>
            ))}
            <SideRow icon={<IconFolder1 size={14} />}>website</SideRow>

            <div className="mt-auto flex items-center">
              <div className="min-w-0 flex-1">
                <SideRow icon={<IconUser size={14} />}>Accounts</SideRow>
              </div>
              <span className="grid size-7 place-items-center text-(--nyte-text-tertiary)">
                <IconSettingsGear2 size={14} />
              </span>
            </div>
          </div>

          <div className="relative min-w-0 flex-1">
            <div className="mx-auto flex max-w-[840px] flex-col gap-2 px-4 pt-[26px] text-[15px]/6">
              <p className="rounded-[12px] border border-(--nyte-stroke-secondary) bg-(--nyte-bg-raised) px-2.5 py-2">
                Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
                sessions we can&rsquo;t read out of the sidebar.
              </p>

              <div className="mt-1 flex flex-col">
                <div className="flex items-center gap-1.5 py-1.5 text-(--nyte-text-secondary)">
                  Worked for 6s
                  <span className="text-(--nyte-text-success) tabular-nums">
                    +{EDIT_STATS.added}
                  </span>
                  <span className="text-(--nyte-text-danger) tabular-nums">
                    -{EDIT_STATS.removed}
                  </span>
                  <IconChevronDownSmall size={12} className="text-(--nyte-text-tertiary)" />
                </div>
                <div className="mt-1 flex flex-col gap-1.5 py-0.5 pl-4">
                  <ToolLine verb="Read" detail="packages/core/src/kernel/store-schemas.ts" />
                  <ToolLine verb="Ran" detail={'rg -n "schemaVersion" packages/core/src'} />
                  <div>
                    <ToolLine verb="Edited" detail="store-schemas.ts">
                      <span className="ml-1 flex shrink-0 gap-1.5 tabular-nums">
                        <span className="text-(--nyte-text-success)">+{EDIT_STATS.added}</span>
                        <span className="text-(--nyte-text-danger)">-{EDIT_STATS.removed}</span>
                      </span>
                    </ToolLine>
                    <div className="mt-1 mb-0.5 overflow-hidden rounded-[6px] border border-(--nyte-conversation-technical-ring) bg-(--nyte-conversation-technical-bg)">
                      <PrerenderedDiff html={diff} className="desktop-diff" />
                    </div>
                  </div>
                  <ToolLine verb="Ran" detail="pnpm --dir packages/core test" />
                </div>
              </div>

              <p className="text-pretty">
                Runs from older schemas now migrate when the store opens. A session that still fails
                to parse stays on disk, but it no longer shows in the sidebar or in search.
              </p>
            </div>

            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-(--nyte-bg-page) from-60% to-transparent px-4 pt-6 pb-4 max-sm:hidden">
              <div className="mx-auto flex h-10 max-w-[808px] items-center gap-2 rounded-full border border-(--nyte-stroke-secondary) bg-(--nyte-bg-raised) py-1 pr-2 pl-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full text-(--nyte-text-primary) shadow-[inset_0_0_0_1px_var(--nyte-stroke-primary),0_1px_2px_rgb(0_0_0/0.06)]">
                  <IconPlusSmall size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-(--nyte-text-tertiary)">
                  Add a follow-up
                </span>
                <span className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[6px] px-1.5 text-[12px] text-(--nyte-text-secondary)">
                  GPT-5.6 Sol
                  <span className="text-(--nyte-text-tertiary)">· High</span>
                  <IconChevronDownMedium size={12} className="text-(--nyte-text-tertiary)" />
                </span>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-(--nyte-text-primary) text-(--nyte-bg-page)">
                  <IconArrowUp size={16} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Bezel>
  );
}
