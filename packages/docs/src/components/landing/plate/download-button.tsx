"use client";

import { Menu, MenuRadioGroup, MenuRadioItem } from "@nyte-ai/ui";
import { IconArrowDown, IconChevronDownSmall } from "central-icons";
import { useState, useSyncExternalStore } from "react";

type Platform = "mac" | "linux" | "windows";

const PLATFORMS = [
  { value: "mac", label: "macOS", detail: "Apple Silicon" },
  { value: "linux", label: "Linux", detail: "Soon" },
  { value: "windows", label: "Windows", detail: "Soon" },
] as const satisfies readonly { value: Platform; label: string; detail: string }[];

function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  if (agent.includes("Windows")) return "windows";
  if (/Linux|X11|CrOS/.test(agent) && !agent.includes("Android")) return "linux";
  return "mac";
}

const noop = () => () => {};

const segmentClass =
  "inline-flex h-11 items-center bg-(--nyte-content-primary) text-(--nyte-bg-base) outline-none transition-[background-color,opacity] focus-visible:ring-2 focus-visible:ring-(--nyte-intent-primary-content) focus-visible:ring-offset-2 focus-visible:ring-offset-(--nyte-bg-base)";

/*
 * The platform is read from the browser after hydration; the server renders the
 * Mac build, which is the only one published. Linux and Windows stay listed so a
 * visitor on either sees where they stand.
 */
export function DownloadButton({ href }: { href: string }) {
  const detected = useSyncExternalStore(noop, detectPlatform, (): Platform => "mac");
  const [chosen, setChosen] = useState<Platform | null>(null);
  const platform =
    PLATFORMS.find((option) => option.value === (chosen ?? detected)) ?? PLATFORMS[0];

  return (
    <div className="inline-flex items-stretch gap-px">
      {platform.value === "mac" ? (
        <a
          href={href}
          className={`${segmentClass} gap-2 rounded-l-full pr-4 pl-5 text-[15px] font-medium hover:bg-(--nyte-content-primary)/85`}
        >
          <IconArrowDown size={16} />
          Download (Apple Silicon)
        </a>
      ) : (
        <span
          aria-disabled="true"
          className={`${segmentClass} cursor-not-allowed rounded-l-full pr-4 pl-5 text-[15px] font-medium opacity-45`}
        >
          Coming soon to {platform.label}
        </span>
      )}

      <Menu
        label="Platform"
        align="end"
        sideOffset={6}
        trigger={
          <button
            type="button"
            aria-label="Choose a platform"
            className={`${segmentClass} cursor-pointer rounded-r-full pr-3.5 pl-2.5 hover:bg-(--nyte-content-primary)/85`}
          >
            <IconChevronDownSmall size={16} />
          </button>
        }
      >
        <MenuRadioGroup
          value={platform.value}
          onValueChange={(value) => {
            const next = PLATFORMS.find((option) => option.value === value);
            if (next) setChosen(next.value);
          }}
        >
          {PLATFORMS.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              layout="plain"
              meta={option.detail}
              disabled={option.value !== "mac"}
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Menu>
    </div>
  );
}
