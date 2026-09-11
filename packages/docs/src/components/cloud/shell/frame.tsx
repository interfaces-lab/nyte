"use client";

import { IconBarsTwo } from "central-icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { NyteWordmark } from "~/components/brand/mark";
import type { CloudNavGroup } from "~/lib/cloud-nav";
import { docsRoute } from "~/lib/shared";
import { CloudSearch } from "./search";
import { CloudSidebar, useDrawer } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

export function CloudFrame({ groups, children }: { groups: CloudNavGroup[]; children: ReactNode }) {
  const drawer = useDrawer();

  return (
    <div className="cloud">
      <header className="cloud-bar">
        <div className="cloud-bar-brand">
          <Link href="/" aria-label="Nyte, home">
            <NyteWordmark size={16} />
          </Link>
          <Link href="/cloud/introduction" className="cloud-eyebrow">
            Cloud
          </Link>
        </div>
        <span className="cloud-bar-crumb">Design system</span>
        <div className="cloud-bar-actions">
          <Link href={`${docsRoute}/design`} className="cloud-bar-link">
            Docs
          </Link>
          <CloudSearch />
          <ThemeToggle />
          <button
            type="button"
            className="cloud-icon-button cloud-menu-button"
            aria-label="Open navigation"
            aria-expanded={drawer.open}
            onClick={drawer.toggle}
          >
            <IconBarsTwo size={16} />
          </button>
        </div>
      </header>
      <div className="cloud-frame">
        <CloudSidebar groups={groups} open={drawer.open} onClose={drawer.close} />
        {children}
      </div>
    </div>
  );
}
