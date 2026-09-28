import { NyteWordmark } from "~/components/brand/mark";
import { SiteMobileNav } from "~/components/site-nav/mobile-menu";
import { SiteSearch } from "~/components/site-nav/search";
import { SiteNavSections } from "~/components/site-nav/sections";
import { ThemeToggle } from "~/components/site-nav/theme-toggle";
import { cloudNavGroups } from "~/lib/cloud-nav";
import { docsNavGroups } from "~/lib/docs-nav";
import { gitConfig } from "~/lib/shared";

const githubHref = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/*
 * Same bar on landing, /docs, and /cloud. Family metrics from the HTML
 * study: 40px, inner 1072, mark then 15/500 links, Search wash. The
 * sections and their one shared panel are a client island, as is Search.
 * The hamburger is a nested Base UI Dialog, only on small viewports.
 *
 * Stays under the dialog layer (70) so a dialog scrim covers the bar too.
 * Off the landing the bar is product chrome: the page surface with no
 * border. On the landing hero plate it joins the blue plane.
 */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 h-(--site-nav-height) w-full min-w-0 shrink-0 bg-(--nyte-bg-page) hero:absolute hero:inset-x-0 hero:bg-transparent plate:top-[calc(var(--plate-inset)+var(--plate-nav-drop))]">
      <div className="relative mx-auto grid h-full w-[min(100%,var(--site-inner))] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5 px-(--site-pad) py-(--site-nav-pad)">
        <a
          href="/"
          aria-label="Nyte, home"
          className="inline-flex items-center text-(--nyte-text-primary) hover:opacity-60 hero:text-white"
        >
          <NyteWordmark size={18} />
        </a>

        <SiteNavSections githubHref={githubHref} />

        <div className="flex items-center gap-2 justify-self-end">
          <ThemeToggle />
          <SiteSearch />
          <SiteMobileNav cloud={cloudNavGroups()} docs={docsNavGroups()} githubHref={githubHref} />
        </div>
      </div>
    </header>
  );
}
