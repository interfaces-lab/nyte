"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGithub } from "central-icons";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { NyteWordmark } from "@/components/brand/mark";
import { docsRoute, gitConfig } from "@/lib/shared";

const links = [{ label: "Docs", href: `${docsRoute}/design`, match: docsRoute }];

/*
 * One navbar for the whole site, rendered from the root layout so it never
 * remounts between / and /docs. Both Fumadocs layouts run with their own nav
 * disabled and --fd-banner-height set to this bar's height, which is the knob
 * that keeps the docs sidebar and TOC sticky beneath it.
 *
 * No rule under it. The first hairline on the page belongs to the demo.
 */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <Link href="/" aria-label="Nyte, home" className="site-nav-brand">
          <NyteWordmark size={18} />
        </Link>

        <nav aria-label="Site" className="site-nav-links">
          {links.map((link) => {
            const current = pathname === link.match || pathname.startsWith(`${link.match}/`);
            return (
              <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-nav-actions">
          <FullSearchTrigger hideIfDisabled className="site-nav-search" />
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="site-nav-icon"
          >
            <IconGithub size={18} />
          </a>
          <ThemeSwitch mode="light-dark" />
        </div>
      </div>
    </header>
  );
}
