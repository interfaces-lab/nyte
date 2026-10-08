import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBlocks,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconCollaborationPointerRight,
  IconDotGrid1x3VerticalTight,
  IconEyeOpen,
  IconFolder1,
  IconFolderOpen,
  IconMacbook,
  IconMagnifyingGlass,
  IconPlusSmall,
  IconServer,
  IconSettingsGear2,
} from "central-icons-desktop";
import type { ReactNode } from "react";

/*
 * The desktop app's chrome, free of server-only imports so a live client
 * component can share it with the prerendered host.
 */

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
    <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-1 text-(--nyte-content-chrome)">
      <span className="grid w-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function PanelGlyph({ side }: { side: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M2.75 6.75C2.75 5.64543 3.64543 4.75 4.75 4.75H19.25C20.3546 4.75 21.25 5.64543 21.25 6.75V17.25C21.25 18.3546 20.3546 19.25 19.25 19.25H4.75C3.64543 19.25 2.75 18.3546 2.75 17.25V6.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d={side === "left" ? "M9 4.75V12V19.25" : "M17.75 8.25V12V15.75"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap={side === "right" ? "round" : undefined}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ToolLine({
  verb,
  detail,
  expandable = false,
  open = false,
  children,
}: {
  verb: string;
  detail: string;
  expandable?: boolean;
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-1 text-muted-foreground">
      <span className="shrink-0">{verb}</span>
      <span className="min-w-0 truncate">{detail}</span>
      {children}
      {expandable ? (
        <IconChevronDownMedium
          size={open ? 10 : 12}
          className={open ? "rotate-180 text-tertiary-foreground" : "text-tertiary-foreground"}
        />
      ) : null}
    </div>
  );
}

export function EditStat({ added, removed }: { added: number; removed: number }) {
  return (
    <>
      <span {...props(intent.success, styles.status)}>+{added}</span>
      <span {...props(intent.danger, styles.status)}>-{removed}</span>
    </>
  );
}

export function DesktopTitleBar() {
  return (
    <div className="flex h-[35px] shrink-0 items-center pr-2.5 text-muted-foreground">
      <div className="flex shrink-0 items-center md:w-[220px]">
        <div className="flex w-[72px] shrink-0 gap-1.5 pl-[11px]">
          <span className="size-3.5 rounded-full bg-foreground/15" />
          <span className="size-3.5 rounded-full bg-foreground/15" />
          <span className="size-3.5 rounded-full bg-foreground/15" />
        </div>
        <span className="grid size-7 place-items-center text-foreground">
          <PanelGlyph side="left" />
        </span>
        <div className="ml-auto mr-2 hidden items-center gap-2 md:flex">
          <span className="grid size-7 place-items-center">
            <IconArrowLeft size={16} />
          </span>
          <span className="grid size-7 place-items-center opacity-50">
            <IconArrowRight size={16} />
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-3">
        <span className="min-w-0 max-w-[240px] flex-1 truncate rounded-[8px] bg-background px-2.5 py-1.5 text-[12px]/4 text-foreground shadow-[inset_0_0_0_1px_var(--nyte-border-secondary-translucent)] max-sm:hidden">
          Migrate stored runs on open
        </span>
        <span className="grid size-7 shrink-0 place-items-center max-sm:hidden">
          <IconPlusSmall size={16} />
        </span>
        <span className="flex-1" />
        <span className="grid size-7 shrink-0 place-items-center">
          <IconDotGrid1x3VerticalTight size={16} />
        </span>
        <span className="grid size-7 shrink-0 place-items-center">
          <PanelGlyph side="right" />
        </span>
      </div>
    </div>
  );
}

export function DesktopSidebar() {
  return (
    <div className="hidden w-[220px] shrink-0 flex-col text-[13px]/[18px] md:flex">
      <div className="flex flex-col gap-px px-2 pt-1.5">
        <SideRow icon={<IconCollaborationPointerRight size={14} />}>New Chat</SideRow>
        <SideRow icon={<IconMagnifyingGlass size={14} />}>Search</SideRow>
        <SideRow icon={<IconBlocks size={14} />}>Customize</SideRow>
        <SideRow icon={<IconServer size={14} />}>Environments</SideRow>
        <SideRow icon={<IconSettingsGear2 size={14} />}>
          <span className="flex items-center justify-between">
            Settings
            <IconChevronRightMedium size={14} />
          </span>
        </SideRow>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-clip p-2">
        <div className="flex h-7 shrink-0 items-center px-1 text-muted-foreground">Workspaces</div>
        <SideRow icon={<IconFolderOpen size={14} />}>nyte</SideRow>
        {CHATS.map((chat) => (
          <div
            key={chat.title}
            data-selected={chat.selected ? "" : undefined}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-1 text-(--nyte-content-chrome) data-selected:bg-fill-selected data-selected:text-foreground data-selected:shadow-[inset_0_0_0_1px_var(--nyte-border-primary)]"
          >
            <span className="grid w-5 shrink-0 place-items-center">
              {chat.mark === "spinner" ? <Spinner style={{ width: 15, height: 15 }} /> : null}
              {chat.mark === "unread" ? <IconEyeOpen size={14} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{chat.title}</span>
            <span className="w-10 shrink-0 text-right text-[11px]/[14px] tracking-[0.07px] text-muted-foreground tabular-nums">
              {chat.time}
            </span>
          </div>
        ))}
        <SideRow icon={<IconFolder1 size={14} />}>website</SideRow>
      </div>
      <div className="flex items-center gap-0.5 p-2">
        <div className="min-w-0 flex-1">
          <SideRow icon={<IconMacbook size={14} />}>Profile</SideRow>
        </div>
        <span className="grid size-7 place-items-center text-muted-foreground">
          <IconSettingsGear2 size={16} />
        </span>
      </div>
    </div>
  );
}

/* The composer pill; `children` is the field, `ready` lights the send button. */
export function DesktopComposer({
  children,
  ready = false,
}: {
  children: ReactNode;
  ready?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-10 max-w-[808px] items-center gap-2 rounded-full border border-border-subtle bg-popover py-1 pr-2 pl-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-popover text-muted-foreground shadow-[inset_0_0_0_1px_var(--nyte-border-primary),var(--nyte-shadow-sm)]">
        <IconPlusSmall size={16} />
      </span>
      {children}
      <span className="inline-flex h-6 min-w-0 shrink items-center gap-1.5 rounded-[6px] px-2 text-[12px]/4 font-medium text-muted-foreground">
        <span className="truncate">GPT-5.6 Luna</span>
        <span>Medium</span>
        <IconChevronDownMedium size={10} className="shrink-0" />
      </span>
      <span {...props(intent.primary, styles.send, ready && styles.ready)}>
        <IconArrowUp size={16} />
      </span>
    </div>
  );
}

const styles = create({
  status: { color: role.contentSecondary },
  send: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 9999,
    opacity: 0.5,
    backgroundColor: role.buttonFill,
    color: role.contentOnInteractiveStrong,
  },
  ready: { opacity: 1 },
});
