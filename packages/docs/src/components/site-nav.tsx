import * as stylex from "@stylexjs/stylex";
import { NyteWordmark } from "~/components/brand/mark";
import { SiteSearch } from "~/components/search";
import { SiteMobileNav } from "~/components/site-nav-menu";
import { SiteNavSections } from "~/components/site-nav-sections";
import { cloudNavGroups } from "~/lib/cloud-nav";
import { docsNavGroups } from "~/lib/docs-nav";
import { gitConfig } from "~/lib/shared";
import { shell, withShell } from "~/shell.stylex";

const githubHref = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/*
 * Same bar on landing, /docs, and /cloud. Family metrics from the HTML
 * study: 94px, inner 1072, mark then 15/500 links, Search wash. The
 * sections and their one shared panel are a client island, as is Search.
 * The hamburger is a nested Base UI Dialog, only on small viewports.
 */
export function SiteNav() {
  return (
    <header {...withShell("site-nav", stylex.props(shell.bar))}>
      <div className="site-nav-inner">
        <a href="/" aria-label="Nyte, home" className="site-nav-brand">
          <NyteWordmark size={18} />
        </a>

        <SiteNavSections githubHref={githubHref} />

        <div className="site-nav-actions">
          <SiteSearch className="site-nav-search" />
          <SiteMobileNav cloud={cloudNavGroups()} docs={docsNavGroups()} githubHref={githubHref} />
        </div>
      </div>
    </header>
  );
}
