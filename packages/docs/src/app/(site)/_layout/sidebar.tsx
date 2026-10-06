"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "~/lib/docs";

/* One level: an optional section label, then its pages. The current page is in ink. */
export function Sidebar({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();

  return (
    <nav className="doc-side hidden flex-col lg:flex gap-6 text-[14px]/5" aria-label="Docs">
      {sections.map((section) => (
        <div key={section.label ?? section.items[0].href}>
          {section.label ? (
            <h2 className="pb-2 font-normal text-tertiary-foreground">{section.label}</h2>
          ) : null}
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block py-1 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
