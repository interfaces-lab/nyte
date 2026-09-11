"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { CloudNavGroup } from "~/lib/cloud-nav";

export function CloudSidebar({
  groups,
  open,
  onClose,
}: {
  groups: CloudNavGroup[];
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {open && <div className="cloud-scrim" onClick={onClose} aria-hidden />}
      <nav className="cloud-side" aria-label="Cloud" data-open={open || undefined}>
        {groups.map((group) => (
          <ul key={group.label || "root"} className="cloud-side-group">
            {group.label && <span className="cloud-eyebrow">{group.label}</span>}
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="cloud-side-row"
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={onClose}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </nav>
    </>
  );
}

/** Drawer state for narrow viewports. Rows close it on click, so no route effect. */
export function useDrawer() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((value) => !value), close: () => setOpen(false) };
}
