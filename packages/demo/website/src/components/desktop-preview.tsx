import type { ComponentProps } from "react";
import {
  IconArrowUp,
  IconMagnifyingGlass,
  IconPlusMedium,
  IconSidebarHiddenRightWide,
  IconUser,
} from "central-icons";
import { Avatar, AvatarFallback } from "@nyte-ai/ui";

export type DesktopPreviewScenario = "conversation" | "search" | "details";

interface DesktopPreviewProps extends Pick<ComponentProps<"div">, "className"> {
  scenario?: DesktopPreviewScenario;
}

const agents = [
  {
    name: "Nyte",
    detail: "Chief of staff",
    mark: "U",
    tone: "orange",
    active: true,
  },
  {
    name: "Tweeter",
    detail: "Social editor",
    mark: "T",
    tone: "blue",
    active: false,
  },
  {
    name: "Slacker",
    detail: "Team concierge",
    mark: "S",
    tone: "violet",
    active: false,
  },
  {
    name: "Rawr",
    detail: "Research lead",
    mark: "R",
    tone: "green",
    active: false,
  },
] as const;

const scenarioLabels: Record<DesktopPreviewScenario, string> = {
  conversation: "conversation",
  search: "search palette",
  details: "bot details",
};

export function DesktopPreview({ className, scenario = "conversation" }: DesktopPreviewProps) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[color:var(--nyte-color-border)] bg-(--nyte-color-background) text-(--nyte-color-foreground) [color-scheme:dark] shadow-[var(--nyte-elevation-dialog)] ${className ?? ""}`}
      aria-label={`Nyte desktop ${scenarioLabels[scenario]} preview`}
      data-demo-scenario={scenario}
      data-nyte-surface="canvas"
    >
      <div className="relative grid aspect-[16/10] min-h-[430px] grid-cols-[minmax(180px,27%)_minmax(0,1fr)] max-[780px]:grid-cols-[76px_minmax(0,1fr)]">
        <aside
          className="flex min-w-0 flex-col border-r-[0.5px] border-[color:var(--nyte-color-border)] bg-(--nyte-color-sidebar) pb-2"
          data-nyte-surface="sidebar"
        >
          <div className="flex h-11 shrink-0 items-center justify-between px-4 max-[780px]:justify-center max-[780px]:px-1">
            <div className="flex gap-2 max-[780px]:hidden" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-macos-close" />
              <span className="size-2.5 rounded-full bg-macos-minimize" />
              <span className="size-2.5 rounded-full bg-macos-zoom" />
            </div>
            <span className="grid size-7 place-items-center rounded-lg text-(--nyte-color-muted-foreground)">
              <IconPlusMedium className="size-4" />
            </span>
          </div>
          <div
            className="mx-3 my-1 flex h-8 items-center gap-2 rounded-lg bg-(--nyte-color-muted) px-2 text-sm/5 text-(--nyte-color-tertiary-foreground) shadow-[inset_0_0_0_.5px_var(--nyte-color-border-weak)] max-[780px]:mx-auto max-[780px]:size-8 max-[780px]:justify-center"
            data-nyte-surface="search"
          >
            <IconMagnifyingGlass size={14} />
            <span className="max-[780px]:hidden">Search</span>
          </div>
          <div className="mt-1 flex flex-1 flex-col px-2">
            {agents.map((agent) => (
              <div
                className={`flex h-[54px] items-center gap-2 rounded-[10px] px-2 ${
                  agent.active ? "bg-(--nyte-color-muted-hover)" : ""
                } max-[780px]:justify-center`}
                data-nyte-surface={agent.active ? "selected" : undefined}
                key={agent.name}
              >
                <Avatar shape="rounded" size="md" tone={agent.tone}>
                  <AvatarFallback>{agent.mark}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 max-[780px]:hidden">
                  <strong className="block truncate text-sm/5 font-medium">{agent.name}</strong>
                  <small className="block truncate text-[13px]/[18px] text-(--nyte-color-tertiary-foreground)">
                    {agent.detail}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <div className="mx-2 flex h-10 items-center gap-2 rounded-[10px] px-2 max-[780px]:justify-center">
            <Avatar size="sm">
              <AvatarFallback>
                <IconUser size={14} />
              </AvatarFallback>
            </Avatar>
            <strong className="min-w-0 truncate text-[13px]/[18px] font-medium max-[780px]:hidden">
              ChatGPT
            </strong>
          </div>
        </aside>

        <section
          className="relative grid min-w-0 grid-rows-[44px_minmax(0,1fr)_auto]"
          data-nyte-surface="conversation"
        >
          <div className="flex items-center gap-1.5 border-b-[0.5px] border-[color:var(--nyte-color-border)] px-3">
            <Avatar shape="rounded" size="xs" tone="orange">
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <strong className="text-[13px]/[18px] font-medium">Nyte</strong>
          </div>
          <div className="flex min-h-0 flex-col justify-center px-4 py-8">
            <div className="flex w-full flex-col text-sm/5">
              <div
                className="ml-auto max-w-[min(88%,640px,calc(100%-82px))] rounded-[18px] bg-(--nyte-color-bubble-user) px-3 py-2 text-(--nyte-color-bubble-user-foreground)"
                data-nyte-surface="bubble-user"
              >
                Help me turn this idea into the smallest real product.
              </div>
              <div
                className="mt-3 max-w-[min(88%,640px,calc(100%-82px))] rounded-[18px] bg-(--nyte-color-bubble-agent) px-3 py-2 text-(--nyte-color-foreground)"
                data-nyte-surface="bubble-agent"
              >
                Start with one honest loop: sign in, ask Nyte, stream the answer, keep the session.
                Everything else can earn its way in.
              </div>
            </div>
          </div>
          <div className="px-4 pb-4">
            <div
              className="flex h-11 items-center rounded-[22px] border border-[color:var(--nyte-color-border)] bg-(--nyte-color-field-background) py-2 pr-2 pl-4 text-sm/5 text-(--nyte-color-tertiary-foreground) shadow-[var(--nyte-elevation-field)]"
              data-nyte-surface="composer"
            >
              <span>Message Nyte</span>
              <span className="ml-auto grid size-7 place-items-center rounded-full bg-(--nyte-color-primary) text-base text-(--nyte-color-primary-foreground)">
                <IconArrowUp className="size-4" />
              </span>
            </div>
          </div>
          {scenario === "details" && <DetailsPreview />}
        </section>
        {scenario === "search" && <SearchPreview />}
      </div>
    </div>
  );
}

function SearchPreview() {
  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-(--nyte-color-scrim) p-5"
      data-nyte-surface="scrim"
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[14px] bg-(--nyte-color-popover) text-(--nyte-color-popover-foreground) shadow-[var(--nyte-elevation-dialog)]"
        data-nyte-surface="palette"
      >
        <div className="flex h-12 items-center gap-2 border-b border-[color:var(--nyte-color-border-weak)] px-3.5 text-sm text-(--nyte-color-muted-foreground)">
          <IconMagnifyingGlass size={16} />
          <span>Search</span>
        </div>
        <div className="space-y-0.5 p-2">
          {agents.map((agent, index) => (
            <div
              className={`flex h-[54px] items-center gap-2 rounded-[10px] px-2 ${
                index === 0 ? "bg-(--nyte-color-muted-hover)" : ""
              }`}
              data-nyte-surface={index === 0 ? "palette-selected" : undefined}
              key={agent.name}
            >
              <Avatar shape="rounded" size="md" tone={agent.tone}>
                <AvatarFallback>{agent.mark}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <strong className="block truncate text-sm/5 font-medium">{agent.name}</strong>
                <small className="block truncate text-[13px]/[18px] text-(--nyte-color-muted-foreground)">
                  {agent.detail}
                </small>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailsPreview() {
  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 w-[38%] min-w-[220px] border-l border-[color:var(--nyte-color-border)] bg-(--nyte-color-background)"
      data-nyte-surface="details"
    >
      <div className="flex h-11 items-center justify-end border-b border-[color:var(--nyte-color-border)] px-2 text-(--nyte-color-muted-foreground)">
        <span className="grid size-8 place-items-center rounded-lg">
          <IconSidebarHiddenRightWide size={16} />
        </span>
      </div>
      <div className="p-5 text-center">
        <div className="flex flex-col items-center border-b border-[color:var(--nyte-color-border)] pb-5">
          <Avatar shape="rounded" size="lg" tone="orange">
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
          <strong className="mt-4 text-lg font-medium tracking-tight">Nyte</strong>
          <span className="mt-1 text-xs text-(--nyte-color-muted-foreground)">Chief of staff</span>
          <p className="mt-4 text-xs/5 text-(--nyte-color-muted-foreground)">
            A real Nyte Core session for thinking, planning, writing, and following through.
          </p>
        </div>
        <div className="pt-5 text-left">
          <span className="inline-flex rounded-full bg-(--nyte-color-muted) px-2 py-1 text-[10px] font-semibold tracking-wider text-(--nyte-color-muted-foreground) uppercase">
            Live
          </span>
          <p className="mt-2.5 text-xs/5 text-(--nyte-color-muted-foreground)">
            ChatGPT connected. Sessions stay on this device; no workspace is required.
          </p>
        </div>
      </div>
    </aside>
  );
}
