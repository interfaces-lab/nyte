import * as stylex from "@stylexjs/stylex";
import { IconBookSimple, IconLayersThree } from "central-icons";
import { NyteWordmark } from "~/components/brand/mark";
import { SiteSearch } from "~/components/search";
import { SiteMobileNav } from "~/components/site-nav-menu";
import { cloudNavGroups } from "~/lib/cloud-nav";
import { docsNavGroups } from "~/lib/docs-nav";
import { SITE_SECTIONS, type SiteFeature, type SiteFeatureIcon } from "~/lib/site-sections";
import { gitConfig } from "~/lib/shared";
import { shell, withShell } from "~/shell.stylex";

const githubHref = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

function FeatureGlyph({ icon }: { icon: SiteFeatureIcon }) {
  switch (icon) {
    case "design":
      return <IconBookSimple size={18} />;
    case "cloud":
      return <IconLayersThree size={18} />;
  }
}

function SiteFeature({ feature }: { feature: SiteFeature }) {
  return (
    <a href={feature.href} className="site-feature">
      <span className="site-feature-icon">
        <FeatureGlyph icon={feature.icon} />
      </span>
      <span className="site-feature-copy">
        <span className="site-feature-title">{feature.title}</span>
        <span className="site-feature-lede">{feature.description}</span>
      </span>
    </a>
  );
}

/*
 * Same bar on landing, /docs, and /cloud. Family metrics from the HTML
 * study: 94px, inner 1072, mark then 15/500 links, Search wash. Hover
 * panels are CSS. Search is a client island. The hamburger is a nested
 * Base UI Dialog, only on small viewports.
 */
export function SiteNav() {
  return (
    <header {...withShell("site-nav", stylex.props(shell.bar))}>
      <div className="site-nav-inner">
        <a href="/" aria-label="Nyte, home" className="site-nav-brand">
          <NyteWordmark size={18} />
        </a>

        <nav aria-label="Site" className="site-sections">
          {SITE_SECTIONS.map((section) => (
            <div key={section.id} className="site-section" data-section={section.id}>
              <a href={section.href} className="site-sections-item">
                {section.label}
              </a>
              <div className="site-panel">
                <div className="site-panel-card">
                  {section.features.map((feature) => (
                    <SiteFeature key={feature.href} feature={feature} />
                  ))}
                </div>
              </div>
            </div>
          ))}
          <a href={githubHref} target="_blank" rel="noreferrer" className="site-sections-item">
            GitHub
          </a>
        </nav>

        <div className="site-nav-actions">
          <SiteSearch className="site-nav-search" />
          <SiteMobileNav cloud={cloudNavGroups()} docs={docsNavGroups()} githubHref={githubHref} />
        </div>
      </div>
    </header>
  );
}
