"use client";

import { useState } from "react";
import { create } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { motion } from "@nyte-ai/ui/vars.stylex";
import { IconBarsTwo, IconCrossSmall } from "central-icons";
import Link from "next/link";
import type { NavSection } from "~/lib/docs";

const styles = create({
  popup: {
    top: "calc(var(--site-nav-height) + 8px)",
    right: "var(--site-pad)",
    left: "var(--site-pad)",
    gap: 0,
    width: "auto",
    maxHeight: "min(72dvh, calc(100dvh - var(--site-nav-height) - 32px))",
    padding: 8,
    overscrollBehavior: "contain",
    transform: "none",
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    translate: {
      default: "0 0",
      "[data-starting-style]": "0 -8px",
      "[data-ending-style]": "0 -8px",
    },
    transitionProperty: "opacity, translate",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

const linkClass =
  "block rounded-lg px-3 py-2 text-[15px] text-muted-foreground hover:bg-fill-hover hover:text-foreground";

export function SiteMobileNav({
  sections,
  githubHref,
}: {
  sections: readonly NavSection[];
  githubHref: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root modal={false} onOpenChange={setOpen} open={open}>
      <Dialog.Trigger
        aria-label="Open navigation"
        className="group hidden size-(--site-nav-control) cursor-pointer items-center justify-center rounded-[10px] bg-fill-selected text-foreground hover:bg-foreground/10 max-lg:inline-flex hero:text-white"
      >
        <span className="group-data-popup-open:hidden">
          <IconBarsTwo size={16} />
        </span>
        <span className="hidden group-data-popup-open:inline-flex">
          <IconCrossSmall size={16} />
        </span>
      </Dialog.Trigger>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title className="sr-only">Navigation</Dialog.Title>
        <nav className="flex min-h-0 flex-col gap-4 overflow-y-auto" aria-label="Site">
          {sections.map((section) => (
            <div key={section.label ?? section.items[0].href}>
              {section.label ? (
                <h2 className="px-3 pb-1 text-[14px] text-tertiary-foreground">{section.label}</h2>
              ) : null}
              {section.items.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass} onClick={close}>
                  {item.title}
                </Link>
              ))}
            </div>
          ))}
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
            onClick={close}
          >
            GitHub
          </a>
        </nav>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
