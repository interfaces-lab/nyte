"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "~/lib/nav";
import { Column } from "./column";

export function Sidebar({ label, groups }: { label: string; groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="doc-side relative h-full min-h-0 min-w-0 overflow-hidden" aria-label={label}>
      <Column>
        {groups.map((group) => (
          <div key={group.label || "root"} className="doc-side-group">
            <p className="doc-side-label">{group.label || "Overview"}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="doc-side-row"
                    aria-current={pathname === item.href ? "page" : undefined}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Column>
    </nav>
  );
}
