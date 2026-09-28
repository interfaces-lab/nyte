"use client";

import { Tabs } from "@nyte-ai/ui/tabs";
import { IconConsole, IconMacbook, IconPhone } from "central-icons";
import type { ReactNode } from "react";

interface HostStageProps {
  desktop: ReactNode;
  terminal: ReactNode;
  mobile: ReactNode;
}

const tabClass =
  "relative z-[1] inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-transparent px-3.5 font-[inherit] text-[13px] font-medium text-white/72 outline-none transition-colors duration-200 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 data-active:text-(--plate-ink)";

const panelClass = "absolute inset-0 animate-host-in motion-reduce:animate-none";

/* One session, three hosts. The panels swap in place; only the one arriving animates. */
export function HostStage({ desktop, terminal, mobile }: HostStageProps) {
  return (
    <Tabs.Root defaultValue="desktop" className="flex flex-col items-center gap-5">
      <Tabs.List
        aria-label="Hosts"
        className="flex gap-0 rounded-full bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur-md ring-inset"
      >
        <Tabs.Indicator className="rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_40/0.2),0_6px_16px_-6px_rgb(0_0_40/0.4)] transition-[left,width] duration-300 ease-nav motion-reduce:transition-none" />
        <Tabs.Tab value="desktop" className={tabClass}>
          <IconMacbook size={16} />
          Desktop
        </Tabs.Tab>
        <Tabs.Tab value="terminal" className={tabClass}>
          <IconConsole size={16} />
          Terminal
        </Tabs.Tab>
        <Tabs.Tab value="mobile" className={tabClass}>
          <IconPhone size={16} />
          Mobile
        </Tabs.Tab>
      </Tabs.List>

      <div className="relative h-[clamp(480px,46vw,540px)] w-full">
        <Tabs.Panel value="desktop" keepMounted className={panelClass}>
          {desktop}
        </Tabs.Panel>
        <Tabs.Panel value="terminal" keepMounted className={panelClass}>
          {terminal}
        </Tabs.Panel>
        <Tabs.Panel value="mobile" keepMounted className={panelClass}>
          {mobile}
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  );
}
