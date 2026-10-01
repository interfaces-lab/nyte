"use client";

import { useState } from "react";
import { create } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui";
import { motion } from "@nyte-ai/ui/vars.stylex";
import {
  IconBarsTwo,
  IconChevronLeftSmall,
  IconChevronRightSmall,
  IconCrossSmall,
} from "central-icons";
import type { NavGroup } from "~/lib/nav";

interface NavLink {
  type: "link";
  title: string;
  href: string;
  external?: boolean;
}

interface NavFolder {
  type: "folder";
  title: string;
  items: NavNode[];
}

type NavNode = NavLink | NavFolder;

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
      "[data-nested-dialog-open]": 0,
    },
    translate: {
      default: "0 0",
      "[data-starting-style]": "0 -8px",
      "[data-ending-style]": "0 -8px",
      "[data-nested][data-starting-style]": "16px 0",
      "[data-nested][data-ending-style]": "16px 0",
    },
    transitionProperty: "opacity, translate",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

const rowClass =
  "flex min-h-14 w-full cursor-pointer items-center rounded-[10px] p-4 text-left text-base font-medium tracking-[-0.2px] text-foreground hover:bg-foreground/5 data-popup-open:bg-foreground/5";

function foldersFrom(groups: NavGroup[]): NavNode[] {
  const nodes: NavNode[] = [];
  for (const group of groups) {
    if (group.label === "") {
      for (const item of group.items) {
        nodes.push({ type: "link", title: item.title, href: item.href });
      }
      continue;
    }
    nodes.push({
      type: "folder",
      title: group.label,
      items: group.items.map((item) => ({
        type: "link",
        title: item.title,
        href: item.href,
      })),
    });
  }
  return nodes;
}

function NavLinkRow({ node, onNavigate }: { node: NavLink; onNavigate: () => void }) {
  if (node.external) {
    return (
      <a
        href={node.href}
        target="_blank"
        rel="noreferrer"
        className={rowClass}
        onClick={onNavigate}
      >
        {node.title}
      </a>
    );
  }
  return (
    <a href={node.href} className={rowClass} onClick={onNavigate}>
      {node.title}
    </a>
  );
}

function NavFolderRow({ node, onNavigate }: { node: NavFolder; onNavigate: () => void }) {
  return (
    <Dialog.Root modal={false}>
      <Dialog.Trigger className={rowClass}>
        {node.title}
        <span className="ml-auto inline-flex text-muted-foreground">
          <IconChevronRightSmall size={16} />
        </span>
      </Dialog.Trigger>
      <Dialog.Popup xstyle={styles.popup}>
        <div className="flex min-h-14 items-center gap-1 px-2 pt-2 pb-1">
          <Dialog.Close
            className="inline-flex size-8 cursor-pointer items-center justify-center text-foreground"
            aria-label="Back"
          >
            <IconChevronLeftSmall size={16} />
          </Dialog.Close>
          <Dialog.Title className="text-base font-medium tracking-[-0.2px]">
            {node.title}
          </Dialog.Title>
        </div>
        <nav className="flex flex-col" aria-label={node.title}>
          <NavNodes nodes={node.items} onNavigate={onNavigate} />
        </nav>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function NavNodes({ nodes, onNavigate }: { nodes: NavNode[]; onNavigate: () => void }) {
  return nodes.map((node) => {
    if (node.type === "link") {
      return <NavLinkRow key={node.href} node={node} onNavigate={onNavigate} />;
    }
    return <NavFolderRow key={node.title} node={node} onNavigate={onNavigate} />;
  });
}

export function SiteMobileNav({
  cloud,
  docs,
  githubHref,
}: {
  cloud: NavGroup[];
  docs: NavGroup[];
  githubHref: string;
}) {
  const [open, setOpen] = useState(false);
  const root: NavNode[] = [
    { type: "folder", title: "Docs", items: foldersFrom(docs) },
    { type: "folder", title: "Cloud", items: foldersFrom(cloud) },
    { type: "link", title: "GitHub", href: githubHref, external: true },
  ];

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
        <nav className="flex flex-col" aria-label="Site">
          <NavNodes nodes={root} onNavigate={() => setOpen(false)} />
        </nav>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
