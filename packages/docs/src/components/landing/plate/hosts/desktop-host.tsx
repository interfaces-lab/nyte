import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

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
import { Spinner } from "@nyte-ai/ui/spinner";
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
    <div className="flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-muted-foreground">
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
      <span className="shrink-0 text-muted-foreground">{verb}</span>
      <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
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
      <div className="desktop-host flex h-full flex-col overflow-hidden rounded-t-[14px] bg-background text-left text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
        <div className="flex h-[35px] shrink-0 border-b border-border-subtle">
          <div className="flex items-center border-r border-border-subtle bg-sidebar pr-1 text-muted-foreground md:w-[190px] lg:w-[220px]">
            <div className="flex w-[72px] shrink-0 gap-2 pl-[11px]">
              <span className="size-3 rounded-full bg-foreground/15" />
              <span className="size-3 rounded-full bg-foreground/15" />
              <span className="size-3 rounded-full bg-foreground/15" />
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
          <div className="flex min-w-0 flex-1 items-center pr-1 pl-3 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate text-[12px]/4 text-muted-foreground max-sm:invisible">
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
          <div className="hidden w-[190px] shrink-0 flex-col gap-px border-r border-border-subtle bg-sidebar p-2 text-[13px]/[18px] md:flex lg:w-[220px]">
            <SideRow icon={<IconCollaborationPointerRight size={14} />}>New Chat</SideRow>
            <SideRow icon={<IconMagnifyingGlass size={14} />}>Search</SideRow>
            <SideRow icon={<IconBlocks size={14} />}>Customize</SideRow>

            <div className="mt-3 flex h-7 items-center px-1 text-muted-foreground">Workspaces</div>
            <SideRow icon={<IconFolderOpen size={14} />}>nyte</SideRow>
            {CHATS.map((chat) => (
              <div
                key={chat.title}
                data-selected={chat.selected ? "" : undefined}
                className="group flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-muted-foreground data-selected:bg-fill-selected data-selected:text-foreground"
              >
                <span className="grid w-5 shrink-0 place-items-center">
                  {chat.mark === "spinner" ? (
                    <Spinner
                      {...props(intent.primary, styles.glyph)}
                      style={{ width: 15, height: 15 }}
                    />
                  ) : null}
                  {chat.mark === "unread" ? (
                    <span {...props(intent.primary, styles.dot)} className="size-2 rounded-full" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="w-10 shrink-0 text-right text-[11px]/[14px] text-muted-foreground tabular-nums group-data-selected:text-muted-foreground">
                  {chat.time}
                </span>
              </div>
            ))}
            <SideRow icon={<IconFolder1 size={14} />}>website</SideRow>

            <div className="mt-auto flex items-center">
              <div className="min-w-0 flex-1">
                <SideRow icon={<IconUser size={14} />}>Accounts</SideRow>
              </div>
              <span className="grid size-7 place-items-center text-muted-foreground">
                <IconSettingsGear2 size={14} />
              </span>
            </div>
          </div>

          <div className="relative min-w-0 flex-1">
            <div className="mx-auto flex max-w-[840px] flex-col gap-2 px-4 pt-[26px] text-[15px]/6">
              <p className="rounded-[12px] border border-border-subtle bg-popover px-2.5 py-2">
                Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
                sessions we can&rsquo;t read out of the sidebar.
              </p>

              <div className="mt-1 flex flex-col">
                <div className="flex items-center gap-1.5 py-1.5 text-muted-foreground">
                  Worked for 6s
                  <span {...props(intent.success, styles.status)} className="tabular-nums">
                    +{EDIT_STATS.added}
                  </span>
                  <span {...props(intent.danger, styles.status)} className="tabular-nums">
                    -{EDIT_STATS.removed}
                  </span>
                  <IconChevronDownSmall size={12} className="text-muted-foreground" />
                </div>
                <div className="mt-1 flex flex-col gap-1.5 py-0.5 pl-4">
                  <ToolLine verb="Read" detail="packages/core/src/kernel/store-schemas.ts" />
                  <ToolLine verb="Ran" detail={'rg -n "schemaVersion" packages/core/src'} />
                  <div>
                    <ToolLine verb="Edited" detail="store-schemas.ts">
                      <span className="ml-1 flex shrink-0 gap-1.5 tabular-nums">
                        <span {...props(intent.success, styles.status)}>+{EDIT_STATS.added}</span>
                        <span {...props(intent.danger, styles.status)}>-{EDIT_STATS.removed}</span>
                      </span>
                    </ToolLine>
                    <div className="mt-1 mb-0.5 overflow-hidden rounded-[6px] border border-border-subtle bg-sidebar">
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

            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-background from-60% to-transparent px-4 pt-6 pb-4 max-sm:hidden">
              <div className="mx-auto flex h-10 max-w-[808px] items-center gap-2 rounded-full border border-border-subtle bg-popover py-1 pr-2 pl-2.5">
                <span
                  {...props(styles.add)}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-foreground"
                >
                  <IconPlusSmall size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground">
                  Add a follow-up
                </span>
                <span className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[6px] px-1.5 text-[12px] text-muted-foreground">
                  GPT-5.6 Sol
                  <span className="text-muted-foreground">· High</span>
                  <IconChevronDownMedium size={12} className="text-muted-foreground" />
                </span>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background">
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

const styles = create({
  status: { color: role.contentSecondary },
  glyph: { color: role.contentInteractiveTertiary },
  dot: { backgroundColor: role.bgInteractiveStrong },
  add: {
    boxShadow: `inset 0 0 0 1px ${role.borderPrimaryTranslucent}, 0 1px 2px rgb(0 0 0 / 0.06)`,
  },
});
