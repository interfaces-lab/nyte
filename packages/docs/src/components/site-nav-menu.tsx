"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@nyte-ai/ui/dialog";
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

function NavShell({ backdrop, children }: { backdrop?: boolean; children: ReactNode }) {
  return (
    <Dialog.Portal>
      {backdrop ? <Dialog.Backdrop className="site-nav-backdrop" /> : null}
      <Dialog.Viewport className="site-nav-viewport">
        <Dialog.Popup className="site-nav-popup">
          <div className="site-nav-card">{children}</div>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
}

function NavLinkRow({ node, onNavigate }: { node: NavLink; onNavigate: () => void }) {
  if (node.external) {
    return (
      <a
        href={node.href}
        target="_blank"
        rel="noreferrer"
        className="site-nav-row"
        onClick={onNavigate}
      >
        {node.title}
      </a>
    );
  }
  return (
    <a href={node.href} className="site-nav-row" onClick={onNavigate}>
      {node.title}
    </a>
  );
}

function NavFolderRow({ node, onNavigate }: { node: NavFolder; onNavigate: () => void }) {
  return (
    <Dialog.Root modal={false}>
      <Dialog.Trigger className="site-nav-row">
        {node.title}
        <span className="site-nav-chevron">
          <IconChevronRightSmall size={16} />
        </span>
      </Dialog.Trigger>
      <NavShell>
        <div className="site-nav-nested-head">
          <Dialog.Close className="site-nav-back" aria-label="Back">
            <IconChevronLeftSmall size={16} />
          </Dialog.Close>
          <Dialog.Title className="site-nav-nested-title">{node.title}</Dialog.Title>
        </div>
        <nav className="site-nav-list" aria-label={node.title}>
          <NavNodes nodes={node.items} onNavigate={onNavigate} />
        </nav>
      </NavShell>
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
      <Dialog.Trigger aria-label="Open navigation" className="site-nav-icon site-nav-menu">
        <span className="site-nav-menu-bars">
          <IconBarsTwo size={16} />
        </span>
        <span className="site-nav-menu-close">
          <IconCrossSmall size={16} />
        </span>
      </Dialog.Trigger>
      <NavShell backdrop>
        <Dialog.Title className="site-nav-hidden">Navigation</Dialog.Title>
        <nav className="site-nav-list" aria-label="Site">
          <NavNodes nodes={root} onNavigate={() => setOpen(false)} />
        </nav>
      </NavShell>
    </Dialog.Root>
  );
}
