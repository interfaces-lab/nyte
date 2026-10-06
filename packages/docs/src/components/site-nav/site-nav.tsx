import { NyteWordmark } from "~/components/brand/mark";
import { SiteMobileNav } from "~/components/site-nav/mobile-menu";
import { SiteSearch } from "~/components/site-nav/search";
import { SiteNavSections } from "~/components/site-nav/sections";
import { ThemeToggle } from "~/components/site-nav/theme-toggle";
import { docsNav } from "~/lib/docs";
import { githubUrl } from "~/lib/shared";

/*
 * One bar, one position: sticky, dropped from the top so its pills sit
 * concentric with the plate's corner on pages that open with a plate. The
 * bar is a frosted pill. Over a plate the pill is transparent and the text
 * is white; once the plate scrolls away (NavSentinel) the pill returns.
 * Stays under the dialog layer (70) so a dialog scrim covers the bar too.
 */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 w-full min-w-0 shrink-0 pt-(--site-nav-top)">
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-[calc(var(--site-pad)-var(--site-nav-pad))]">
        <div className="grid h-(--site-nav-height) min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5 rounded-full bg-background/80 px-(--site-nav-pad) ring-1 ring-border-subtle backdrop-blur-xl transition-[background-color,box-shadow] duration-200 hero:bg-transparent hero:ring-transparent hero:backdrop-blur-none">
          <a
            href="/"
            aria-label="Nyte, home"
            className="inline-flex items-center pl-2.5 text-foreground hover:opacity-60 hero:text-white"
          >
            <NyteWordmark size={18} />
          </a>

          <SiteNavSections githubHref={githubUrl} />

          <div className="flex items-center gap-2 justify-self-end">
            <ThemeToggle />
            <SiteSearch />
            <SiteMobileNav sections={docsNav} githubHref={githubUrl} />
          </div>
        </div>
      </div>
    </header>
  );
}
