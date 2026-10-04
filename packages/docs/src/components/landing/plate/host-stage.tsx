"use client";

import { Tabs } from "@nyte-ai/ui/tabs";
import { IconPhone } from "central-icons";
import type { ReactNode } from "react";
import { DitherMoon } from "./dither-moon";

const HOSTS = [
  {
    value: "terminal",
    label: "Terminal",
    tile: (
      <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#2c2c2c,#0a0a0a)] font-mono text-[15px] font-semibold text-[#f5f5f5]">
        &gt;_
      </span>
    ),
  },
  {
    value: "desktop",
    label: "Desktop",
    tile: (
      <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#232a44,#0c1020)] text-[#c1d0f6]">
        <DitherMoon cells={10} pixel={3} />
      </span>
    ),
  },
  {
    value: "mobile",
    label: "Mobile",
    tile: (
      <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#4a5af2,#2222dd)] text-white">
        <IconPhone size={22} />
      </span>
    ),
  },
] as const;

type Host = (typeof HOSTS)[number]["value"];

const tileShadow =
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_0_0_1px_rgb(255_255_255/0.06),0_8px_16px_-8px_rgb(12_16_32/0.5),0_1px_2px_rgb(12_16_32/0.2)]";

/* One session, three hosts. The dock swaps the window in place; only the one arriving animates. */
export function HostStage({ hosts }: { hosts: Record<Host, ReactNode> }) {
  return (
    <Tabs.Root
      defaultValue="desktop"
      className="relative overflow-hidden bg-(--panel) text-left text-foreground [--panel:color-mix(in_oklab,var(--color-foreground)_4%,var(--color-background))] after:pointer-events-none after:absolute after:inset-0 after:border after:border-border-subtle"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border-strong)_1px,transparent_1.5px)] bg-size-[14px_14px] mask-[radial-gradient(80%_70%_at_50%_0%,black,transparent)]"
      />

      <div className="relative h-[clamp(460px,46vw,600px)] px-6 pt-10 md:px-10 md:pt-14">
        {HOSTS.map((host) => (
          <Tabs.Panel
            key={host.value}
            value={host.value}
            keepMounted
            className="relative h-full animate-host-in motion-reduce:animate-none"
          >
            {hosts[host.value]}
          </Tabs.Panel>
        ))}
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-linear-to-t from-(--panel) from-30% to-transparent"
      />

      <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 md:bottom-6">
        <Tabs.List
          aria-label="Hosts"
          className="flex items-end gap-2.5 rounded-[22px] bg-background/70 p-2.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)] ring-1 ring-border-subtle backdrop-blur-xl ring-inset"
        >
          {HOSTS.map((host) => (
            <Tabs.Tab
              key={host.value}
              value={host.value}
              aria-label={host.label}
              className="group relative size-12 cursor-pointer rounded-[25%] bg-transparent p-0 outline-none [corner-shape:squircle] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span
                className={`block size-full rounded-[inherit] transition-[translate,scale] duration-200 ease-nav group-hover:-translate-y-1 group-active:scale-[0.94] motion-reduce:transition-none ${tileShadow}`}
              >
                {host.tile}
              </span>
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[12px]/4 font-medium whitespace-nowrap text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                {host.label}
              </span>
              <span className="absolute -bottom-[7px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground opacity-0 transition-opacity duration-200 group-data-active:opacity-100" />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>
    </Tabs.Root>
  );
}
