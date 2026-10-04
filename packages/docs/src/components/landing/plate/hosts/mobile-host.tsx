import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";
import {
  IconBellActive,
  IconChevronDownSmall,
  IconChevronLeft,
  IconChevronRightSmall,
  IconCheckmark1Small,
  IconDotGrid1x3Horizontal,
  IconMacbook,
  IconMagnifyingGlass,
  IconPin,
  IconPlusLarge,
  IconSquareBehindSquare6,
} from "central-icons";
import type { ReactNode } from "react";

function palette(scheme: "light" | "dark") {
  const colors = platformColors[scheme];
  const scopes = platformScopes[scheme];
  return {
    foreground: colors.contentPrimary,
    muted: colors.contentSecondary,
    background: colors.bgChrome,
    canvas: scheme === "dark" ? colors.bgChrome : colors.bgBase,
    surface: scheme === "dark" ? colors.bgElevated : colors.bgBase,
    raised: colors.bgPressed,
    fill: colors.bgInteractiveSecondaryTranslucent,
    border: colors.borderSecondaryTranslucent,
    accent: scopes.blue.contentSecondary,
    success: scopes.green.contentSecondary,
    danger: scopes.red.contentSecondary,
    warning: scopes.yellow.contentSecondary,
  };
}

const darkPalette = Object.values(palette("dark"));

const mobilePalette = {
  ...Object.fromEntries(
    Object.entries(palette("light")).map(([name, light], index) => [
      `--mobile-${name}`,
      `light-dark(${light}, ${darkPalette[index] ?? light})`,
    ]),
  ),
  color: "var(--mobile-foreground)",
};

type InboxStatus = "working" | "waiting" | "finished";

const INBOX_SECTIONS = [
  {
    title: "Needs input",
    agents: [
      { title: "Stamp tool class on commits", meta: "Needs input · Now", status: "waiting" },
    ],
  },
  {
    title: "Working",
    agents: [{ title: "Migrate stored runs on open", meta: "Working · 42s", status: "working" }],
  },
  {
    title: "Today",
    agents: [
      { title: "Unblock desktop release", meta: "Finished · 5m", status: "finished" },
      { title: "Preserve tool errors", meta: "Finished · 2h", status: "finished" },
    ],
  },
  {
    title: "Earlier",
    agents: [{ title: "Restore scroll position", meta: "Finished · 1d", status: "finished" }],
  },
] as const satisfies readonly {
  title: string;
  agents: readonly { title: string; meta: string; status: InboxStatus }[];
}[];

function StatusBar() {
  return (
    <div className="relative z-20 flex h-[54px] shrink-0 items-center justify-between px-[28px] pt-[2px] text-(--mobile-foreground)">
      <span className="w-[54px] text-center text-[15px]/5 font-semibold tracking-[-0.02em] tabular-nums">
        9:41
      </span>
      <div className="flex items-center gap-[6px]">
        <svg aria-hidden="true" viewBox="0 0 18 12" className="h-3 w-[18px] fill-current">
          <rect x="0" y="7.5" width="3" height="4.5" rx="1" />
          <rect x="5" y="5" width="3" height="7" rx="1" />
          <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg
          aria-hidden="true"
          viewBox="0 0 17 12"
          className="h-3 w-[17px] fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <path d="M1 3.7c4.4-3.6 10.6-3.6 15 0" />
          <path d="M3.8 6.6c2.8-2.2 6.6-2.2 9.4 0" />
          <path d="M6.8 9.4c1-.7 2.4-.7 3.4 0" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 27 13" className="h-[13px] w-[27px]">
          <rect
            x="0.75"
            y="0.75"
            width="22"
            height="11.5"
            rx="3.2"
            className="fill-none stroke-current opacity-40"
            strokeWidth="1.5"
          />
          <rect x="2.5" y="2.5" width="18.5" height="8" rx="1.7" className="fill-current" />
          <path
            d="M24.5 4.3v4.4c1.1-.4 1.8-1.2 1.8-2.2s-.7-1.8-1.8-2.2Z"
            className="fill-current opacity-40"
          />
        </svg>
      </div>
    </div>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[844px] w-[390px] rounded-[54px] bg-[#171719] p-[6px] shadow-[0_40px_90px_-30px_rgb(6_6_70/0.65)] ring-1 ring-black/70">
      <div className="relative h-full overflow-hidden rounded-[48px] bg-(--mobile-background) text-(--mobile-foreground) shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]">
        <div className="absolute top-[11px] left-1/2 z-30 h-[35px] w-[126px] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" />
        {children}
        <div className="absolute bottom-2 left-1/2 z-20 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-(--mobile-foreground)" />
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: InboxStatus }) {
  if (status === "working") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="size-[14px] animate-[ios-spin_0.8s_steps(8)_infinite] fill-current text-(--mobile-accent) motion-reduce:animate-none"
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((spoke) => (
          <rect
            key={spoke}
            x="7.1"
            y="0.8"
            width="1.8"
            height="4.4"
            rx="0.9"
            opacity={1 - spoke * 0.1}
            transform={`rotate(${-spoke * 45} 8 8)`}
          />
        ))}
      </svg>
    );
  }

  if (status === "waiting") {
    return <span className="size-2 rounded-full bg-(--mobile-accent)" />;
  }

  return <IconCheckmark1Small size={12} className="text-(--mobile-success) [&_path]:stroke-2" />;
}

const glassControlClass =
  "grid size-11 shrink-0 place-items-center rounded-full bg-(--mobile-surface)/80 shadow-[0_2px_12px_rgb(0_0_0/0.08)] ring-[0.5px] ring-(--mobile-border) backdrop-blur-xl dark:shadow-none";

function WorkingFilterIcon() {
  return (
    <svg viewBox="0 0 22 22" className="size-[22px] fill-none stroke-current" strokeWidth="1.5">
      {[
        [11, 4],
        [4, 11],
        [11, 11],
        [18, 11],
        [11, 18],
      ].map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r="2.5" />
      ))}
    </svg>
  );
}

const FILTER_CARDS = [
  {
    label: "All Agents",
    count: 5,
    icon: <IconSquareBehindSquare6 size={22} />,
    tone: "text-(--mobile-muted)",
  },
  {
    label: "Needs you",
    count: 1,
    icon: <IconBellActive size={22} />,
    tone: "text-(--mobile-warning)",
  },
  { label: "Working", count: 1, icon: <WorkingFilterIcon />, tone: "text-(--mobile-accent)" },
  { label: "Pinned", count: 0, icon: <IconPin size={22} />, tone: "text-(--mobile-success)" },
];

function Composer({ inbox = false }: { inbox?: boolean }) {
  return (
    <div
      className={`shrink-0 pt-1 pb-[38px] ${inbox ? "bg-(--mobile-background) px-5" : "bg-(--mobile-canvas) px-3"}`}
    >
      {inbox ? (
        <div className="mb-1 flex h-11 items-center gap-1 text-[13px]/[18px] font-medium text-(--mobile-muted)">
          <span>nyte</span>
          <IconChevronDownSmall size={10} />
        </div>
      ) : null}
      <div className="relative mx-4 flex h-12 items-center rounded-[24px] bg-(--mobile-surface)/80 ring-[0.5px] ring-(--mobile-border) backdrop-blur-xl">
        <span className="grid size-11 shrink-0 place-items-center">
          <IconPlusLarge size={20} />
        </span>
        <span className="min-w-0 flex-1 text-[17px]/[22px] text-(--mobile-muted)">
          {inbox ? "Ask anything" : "Follow up…"}
        </span>
        <span className="grid size-11 shrink-0 place-items-center">
          <svg viewBox="0 0 22 22" className="size-[22px] fill-current">
            <rect x="7.5" y="1.5" width="7" height="12" rx="3.5" />
            <path d="M4.5 9.5a.9.9 0 0 1 1.8 0v1a4.7 4.7 0 0 0 9.4 0v-1a.9.9 0 0 1 1.8 0v1a6.5 6.5 0 0 1-5.6 6.44v2.66h3.2v1.8H6.9v-1.8h3.2v-2.66a6.5 6.5 0 0 1-5.6-6.44Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function AgentsPhone() {
  return (
    <Phone>
      <div className="flex h-full flex-col bg-(--mobile-background)">
        <StatusBar />
        <div className="flex h-11 shrink-0 items-center px-5">
          <span className={glassControlClass}>
            <IconMacbook size={17} />
          </span>
        </div>
        <div className="shrink-0 px-5 pt-1">
          <h2 className="text-[22px]/7 font-semibold">Agents</h2>
          <div className="mt-3 mb-3 flex h-9 items-center gap-2 rounded-[10px] bg-(--mobile-fill) px-3 text-(--mobile-muted)">
            <IconMagnifyingGlass size={16} />
            <span className="text-[17px]/[22px]">Search agents</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden pt-1">
          <div className="grid grid-cols-2 gap-2 px-5 pb-3">
            {FILTER_CARDS.map((card, index) => (
              <div
                key={card.label}
                className={`flex flex-col gap-4 rounded-xl border p-3 ${index === 0 ? "border-(--mobile-foreground) bg-(--mobile-fill)" : "border-(--mobile-border)"}`}
              >
                <span className={card.tone}>{card.icon}</span>
                <div className="flex items-baseline gap-1 text-[16px]/[22px]">
                  <span>{card.label}</span>
                  <span className="text-(--mobile-muted)">{card.count}</span>
                </div>
              </div>
            ))}
          </div>
          {INBOX_SECTIONS.map((section, sectionIndex) => (
            <section key={section.title} className={sectionIndex === 0 ? "" : "pt-7"}>
              <h3 className="px-5 pb-1.5 text-[13px]/[18px] font-normal text-(--mobile-muted)">
                {section.title}
              </h3>
              {section.agents.map((agent, index) => (
                <div key={agent.title} className="flex items-start pl-5">
                  <div className="mt-3 flex h-[22px] w-[14px] shrink-0 items-center justify-center">
                    <StatusMark status={agent.status} />
                  </div>
                  <div
                    className={`ml-3 flex min-w-0 flex-1 flex-col gap-0.5 py-3 pr-5 ${index === section.agents.length - 1 ? "" : "border-b-[0.5px] border-(--mobile-border)"}`}
                  >
                    <span className="truncate text-[16px]/[22px]">{agent.title}</span>
                    <span
                      className={`truncate text-[15px]/5 tabular-nums ${agent.status === "waiting" ? "text-(--mobile-foreground)" : "text-(--mobile-muted)"}`}
                    >
                      {agent.meta}
                    </span>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
        <Composer inbox />
      </div>
    </Phone>
  );
}

function ToolRow({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1.5">
      <div className="flex min-h-11 items-center gap-1 text-[15px]/5 text-(--mobile-muted)">
        <span className="min-w-0">{children}</span>
        <IconChevronRightSmall size={11} className="shrink-0 [&_path]:stroke-2" />
      </div>
    </div>
  );
}

function ChatPhone() {
  return (
    <Phone>
      <div className="flex h-full flex-col bg-(--mobile-canvas)">
        <div className="relative z-10 shrink-0 bg-(--mobile-background)/80 backdrop-blur-xl">
          <StatusBar />
          <div className="relative flex h-11 items-center px-4">
            <span className={glassControlClass}>
              <IconChevronLeft size={22} />
            </span>
            <h2 className="absolute inset-x-[64px] truncate text-center text-[17px]/[22px] font-semibold">
              Migrate stored runs on open
            </h2>
            <span className={`ml-auto ${glassControlClass}`}>
              <IconDotGrid1x3Horizontal size={18} />
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 pt-3">
          <div className="mt-4 flex justify-end py-1">
            <p className="max-w-[80%] rounded-[20px] bg-(--mobile-raised) px-[14px] py-[10px] text-[16px]/[22px]">
              Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
              sessions we can&apos;t read out of the sidebar.
            </p>
          </div>

          <div className="px-2 py-1.5">
            <div className="flex min-h-11 items-center gap-1 text-[15px]/5 text-(--mobile-muted)">
              <span>Finished</span>
              <span className="tabular-nums opacity-70">6s</span>
              <IconChevronRightSmall size={13} className="rotate-90 [&_path]:stroke-2" />
            </div>
            <div className="pl-[22px]">
              <ToolRow>Read store-schemas.ts</ToolRow>
              <ToolRow>Ran rg -n &quot;schemaVersion&quot; packages/core/src</ToolRow>
              <div className="flex min-h-11 min-w-0 items-center gap-2 text-[15px]/5">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-(--mobile-fill) text-[11px]/[14px] font-semibold text-(--mobile-muted)">
                  M
                </span>
                <span className="min-w-0 flex-1 truncate">store-schemas.ts</span>
                <span className="shrink-0 text-[13px]/[18px] text-(--mobile-muted) tabular-nums">
                  +3 −1
                </span>
                <IconChevronRightSmall size={13} className="shrink-0 text-(--mobile-muted)" />
              </div>
              <ToolRow>Ran pnpm --dir packages/core test</ToolRow>
            </div>
          </div>

          <div className="px-2 py-1.5">
            <p className="text-[16px]/[22px]">
              Runs from older schemas now migrate when the store opens. A session that still fails
              to parse stays on disk, but it no longer shows in the sidebar or in search.
            </p>
          </div>
          <div className="flex min-h-11 items-center text-[13px]/[18px] text-(--mobile-muted)">
            Copy Message
          </div>
        </div>
        <div className="flex shrink-0 gap-2 bg-(--mobile-canvas) px-3 pb-2 text-[13px]/[18px] font-medium">
          <span className="flex min-h-11 items-center rounded-full bg-(--mobile-surface) px-[14px] ring-[0.5px] ring-(--mobile-border)">
            Review&nbsp;<span className="text-(--mobile-success)">+3&nbsp;</span>
            <span className="text-(--mobile-danger)">−1</span>
          </span>
          <span className="flex min-h-11 items-center rounded-full bg-(--mobile-surface) px-[14px] ring-[0.5px] ring-(--mobile-border)">
            Ask to Merge
          </span>
        </div>
        <Composer />
      </div>
    </Phone>
  );
}

const phoneSlotClass =
  "relative h-full w-[calc((100cqh-72px)*390/844)] shrink-0 [&>div]:absolute [&>div]:top-0 [&>div]:left-0 [&>div]:origin-top-left [&>div]:scale-[calc((100cqh-72px)/844px)]";

export function MobileHost() {
  return (
    <div
      aria-hidden="true"
      style={mobilePalette}
      className="pointer-events-none relative h-full w-full overflow-hidden text-left font-[system-ui,-apple-system,'SF_Pro_Text',sans-serif] antialiased [container-type:size]"
    >
      <div className="absolute inset-x-0 top-0 bottom-[72px] flex justify-center gap-8 md:gap-9 lg:gap-10 xl:gap-12">
        <div className={`${phoneSlotClass} hidden sm:block`}>
          <AgentsPhone />
        </div>
        <div className={phoneSlotClass}>
          <ChatPhone />
        </div>
      </div>
    </div>
  );
}
