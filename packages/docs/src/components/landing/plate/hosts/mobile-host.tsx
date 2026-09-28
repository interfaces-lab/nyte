import {
  IconChevronLeft,
  IconChevronRightSmall,
  IconCheckmark1Small,
  IconDotGrid1x3Horizontal,
  IconMacbook,
  IconMagnifyingGlass,
} from "central-icons";
import type { ReactNode } from "react";

type InboxStatus = "working" | "waiting" | "finished";

const INBOX_SECTIONS = [
  {
    title: "Needs input",
    agents: [{ title: "Stamp tool class on commits", meta: "Needs input", status: "waiting" }],
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
      { title: "Restore scroll position", meta: "Finished · 1d", status: "finished" },
    ],
  },
] as const satisfies readonly {
  title: string;
  agents: readonly { title: string; meta: string; status: InboxStatus }[];
}[];

function StatusBar() {
  return (
    <div className="relative z-20 flex h-[54px] shrink-0 items-center justify-between px-[28px] pt-[2px] text-[#141414] dark:text-[#fcfcfc]">
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
      <div className="relative h-full overflow-hidden rounded-[48px] bg-[#f7f7f7] text-[#141414] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] dark:bg-[#141414] dark:text-[#fcfcfc]">
        <div className="absolute top-[11px] left-1/2 z-30 h-[35px] w-[126px] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" />
        {children}
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: InboxStatus }) {
  if (status === "working") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="size-[14px] animate-[ios-spin_0.8s_steps(8)_infinite] fill-current text-[#0c64c1] motion-reduce:animate-none dark:text-[#459ffe]"
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
    return <span className="size-2 rounded-full bg-[#0c64c1] dark:bg-[#459ffe]" />;
  }

  return <IconCheckmark1Small size={14} className="text-[#007a45] dark:text-[#38d591]" />;
}

function AgentsPhone() {
  return (
    <Phone>
      <div className="flex h-full flex-col bg-[#f7f7f7] dark:bg-[#141414]">
        <StatusBar />
        <div className="relative flex h-10 shrink-0 items-center px-5">
          <IconMacbook size={20} />
        </div>
        <div className="px-5 pt-1">
          <h2 className="text-[22px]/7 font-semibold tracking-[-0.02em]">Agents</h2>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-[10px] bg-[#1414140a] px-3 text-[#14141499] dark:bg-[#fcfcfc14] dark:text-[#fcfcfc99]">
            <IconMagnifyingGlass size={16} />
            <span className="text-[15px]/5">Search agents</span>
          </div>
        </div>

        <div className="pt-5">
          {INBOX_SECTIONS.map((section, sectionIndex) => (
            <section key={section.title} className={sectionIndex === 0 ? "" : "mt-5"}>
              <h3 className="px-5 pb-1 text-[13px]/[18px] font-medium text-[#14141499] dark:text-[#fcfcfc99]">
                {section.title}
              </h3>
              {section.agents.map((agent, index) => (
                <div key={agent.title} className="flex min-h-[68px] pl-5">
                  <div className="flex w-[14px] shrink-0 items-start justify-center pt-[16px]">
                    <StatusMark status={agent.status} />
                  </div>
                  <div
                    className={`ml-3 flex min-w-0 flex-1 flex-col justify-center pr-5 ${index === section.agents.length - 1 ? "" : "border-b border-[#14141414] dark:border-[#fcfcfc14]"}`}
                  >
                    <span className="truncate text-[16px]/[22px]">{agent.title}</span>
                    <span className="mt-0.5 truncate text-[15px]/5 text-[#14141499] tabular-nums dark:text-[#fcfcfc99]">
                      {agent.meta}
                    </span>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Phone>
  );
}

function ToolRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 text-[15px]/5 text-[#14141499] dark:text-[#fcfcfc99]">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <IconChevronRightSmall
        size={13}
        className="shrink-0 text-[#1414145c] dark:text-[#fcfcfc5c]"
      />
    </div>
  );
}

function ChatPhone() {
  return (
    <Phone>
      <div className="relative h-full bg-white dark:bg-[#141414]">
        <div className="relative z-10 bg-white/80 backdrop-blur-xl dark:bg-[#141414]/80">
          <StatusBar />
          <div className="relative flex h-11 items-center px-4">
            <IconChevronLeft size={22} className="text-[#0c64c1] dark:text-[#459ffe]" />
            <h2 className="absolute inset-x-[54px] truncate text-center text-[17px]/[22px] font-semibold tracking-[-0.01em]">
              Migrate stored runs on open
            </h2>
            <span className="ml-auto grid size-8 place-items-center rounded-full bg-white/70 shadow-[0_1px_8px_rgb(0_0_0/0.1)] ring-1 ring-black/[0.04] backdrop-blur-xl dark:bg-white/10 dark:ring-white/10">
              <IconDotGrid1x3Horizontal size={18} />
            </span>
          </div>
        </div>

        <div className="px-3 pt-5">
          <p className="ml-auto max-w-[80%] rounded-[20px] bg-[#eeeeee] px-[14px] py-[10px] text-[16px]/[22px] text-pretty dark:bg-[#2f2f2f]">
            Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
            sessions we can&apos;t read out of the sidebar.
          </p>

          <div className="mt-4 px-2 py-1.5">
            <div className="flex h-11 items-center gap-1 text-[15px]/5 text-[#14141499] dark:text-[#fcfcfc99]">
              <span>Finished</span>
              <span className="opacity-70">·</span>
              <span className="tabular-nums opacity-70">6s</span>
              <IconChevronRightSmall
                size={13}
                className="rotate-90 text-[#1414145c] dark:text-[#fcfcfc5c]"
              />
            </div>
            <div>
              <ToolRow>Read store-schemas.ts</ToolRow>
              <ToolRow>
                <span>
                  Ran <code className="font-mono text-[13px]">rg -n &quot;schemaVersion&quot;</code>
                </span>
              </ToolRow>
              <div className="flex h-9 min-w-0 items-center gap-2 text-[15px]/5">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-[#1414140a] text-[11px]/[14px] font-semibold text-[#14141499] dark:bg-[#fcfcfc14] dark:text-[#fcfcfc99]">
                  M
                </span>
                <span className="min-w-0 flex-1 truncate">store-schemas.ts</span>
                <span className="shrink-0 text-[13px]/[18px] tabular-nums">
                  <span className="text-[#007a45] dark:text-[#38d591]">+3</span>{" "}
                  <span className="text-[#c21d2e] dark:text-[#ff5667]">−1</span>
                </span>
                <IconChevronRightSmall
                  size={13}
                  className="shrink-0 text-[#1414145c] dark:text-[#fcfcfc5c]"
                />
              </div>
              <ToolRow>
                <span>
                  Ran <code className="font-mono text-[13px]">pnpm --dir packages/core test</code>
                </span>
              </ToolRow>
            </div>
          </div>

          <p className="mt-2 px-2 text-[16px]/[22px] text-pretty">
            Runs from older schemas now migrate when the store opens. A session that still fails to
            parse stays on disk, but it no longer shows in the sidebar or in search.
          </p>
        </div>
      </div>
    </Phone>
  );
}

const phoneSlotClass =
  "relative h-[676px] w-[312px] shrink-0 [&>div]:absolute [&>div]:top-0 [&>div]:left-0 [&>div]:origin-top-left [&>div]:scale-[0.8] sm:h-[600px] sm:w-[277px] sm:[&>div]:scale-[0.71] md:h-[693px] md:w-[320px] md:[&>div]:scale-[0.821] lg:h-[779px] lg:w-[360px] lg:[&>div]:scale-[0.923] xl:h-[844px] xl:w-[390px] xl:[&>div]:scale-100";

export function MobileHost() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative h-full w-full overflow-hidden text-left font-[system-ui,-apple-system,'SF_Pro_Text',sans-serif] antialiased"
    >
      <div className="absolute inset-x-0 top-0 flex justify-center gap-8 md:gap-9 lg:gap-10 xl:gap-12">
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
