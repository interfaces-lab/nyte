"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import type { NavGroup } from "~/lib/nav";

/*
 * Four groups. The one holding the current page is open; the rest fold to
 * their heading and a count. Sub-groups are labels inside a group.
 */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const openLabel =
    groups.find((group) => group.items.some((item) => item.href === pathname))?.label ??
    groups[0]?.label;

  return (
    <nav className="doc-side" aria-label="Docs">
      {groups.map((group) => (
        <details key={group.label} className="group mb-3" open={group.label === openLabel}>
          <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-full px-2.5 font-mono text-[12px] font-medium text-tertiary-foreground transition-colors hover:bg-fill-hover hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span>{group.label}</span>
            <span className="font-normal">{group.items.length}</span>
          </summary>
          <ul className="mt-1 flex flex-col gap-px">
            {group.items.map((item, index) => {
              const sub = item.sub;
              const newSub = sub && sub !== group.items[index - 1]?.sub;
              return (
                <Fragment key={item.href}>
                  {newSub ? (
                    <li
                      className="mt-2 mb-0.5 px-2.5 text-[12px]/6 font-medium text-tertiary-foreground"
                      aria-hidden="true"
                    >
                      {sub}
                    </li>
                  ) : null}
                  <li>
                    <Link
                      href={item.href}
                      className="flex h-8 items-center rounded-full px-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground aria-[current=page]:bg-fill-selected aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                      aria-current={pathname === item.href ? "page" : undefined}
                    >
                      {item.title}
                    </Link>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </details>
      ))}
    </nav>
  );
}
