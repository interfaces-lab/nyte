import { FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Link } from "@tanstack/react-router";
import { glyphs } from "~/lib/glyphs";
import { useState, type ReactNode } from "react";
import { MobileMenu } from "~/components/site-nav/mobile-menu";
import { SearchDialog, useSearchShortcut } from "~/components/site-nav/search";
import { HrefLink } from "~/components/site/href-link";
import { designRoute, docsRoute, githubUrl } from "~/lib/shared";
import { DesignWordmark } from "./mark";
import { DesignNav } from "./nav";
import { ThemeSwitch } from "./theme-switch";

const { IconMagnifyingGlass } = glyphs;

/**
 * design.nyte.sh's own frame, apart from the Nyte site's navbar: a rail with
 * the index on wide screens, a bar with a menu on narrow ones, and the page.
 * Its hairlines are the page grid, drawn where nothing crosses them.
 */
export function DesignShell({ children }: { children: ReactNode }) {
  const [searching, setSearching] = useState(false);

  useSearchShortcut(setSearching);

  return (
    <div className="doc design">
      <FileTypeIconSprite />
      <header className="design-bar">
        <Link to={designRoute} aria-label="Nyte Design, home" className="design-home">
          <DesignWordmark />
        </Link>
        <div className="design-bar-actions">
          <button
            type="button"
            aria-label="Search"
            className="design-bar-button"
            onClick={() => setSearching(true)}
          >
            <IconMagnifyingGlass size={16} />
          </button>
          <MobileMenu buttonClassName="design-bar-button" panelClassName="design-menu">
            {(close) => (
              <>
                <DesignNav onNavigate={close} />
                <div className="design-menu-foot">
                  <ThemeSwitch />
                  <ElsewhereLinks onNavigate={close} />
                </div>
              </>
            )}
          </MobileMenu>
        </div>
      </header>
      <div className="design-frame">
        <aside className="design-rail">
          <Link to={designRoute} aria-label="Nyte Design, home" className="design-home">
            <DesignWordmark />
          </Link>
          <button type="button" className="design-search" onClick={() => setSearching(true)}>
            <IconMagnifyingGlass size={14} />
            <span>Search</span>
            <Kbd keys={["⌘", "K"]} />
          </button>
          <div className="design-rail-scroll">
            <DesignNav />
          </div>
          <div className="design-rail-foot">
            <ThemeSwitch />
            <ElsewhereLinks />
          </div>
        </aside>
        {children}
      </div>
      <SearchDialog open={searching} onOpenChange={setSearching} />
    </div>
  );
}

/** The page column: the ruler that marks the grid, the page, then the footer. */
export function DesignMain({ children }: { children: ReactNode }) {
  return (
    <main className="design-main">
      <div className="design-ruler" aria-hidden="true" />
      {children}
      <footer className="design-footer">
        <Link to={designRoute} aria-label="Nyte Design, home" className="design-home">
          <DesignWordmark />
        </Link>
        <ElsewhereLinks />
      </footer>
    </main>
  );
}

function ElsewhereLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Elsewhere" className="design-elsewhere">
      <HrefLink href="/" onClick={onNavigate}>
        Nyte
      </HrefLink>
      <HrefLink href={docsRoute} onClick={onNavigate}>
        Docs
      </HrefLink>
      <a href={githubUrl} target="_blank" rel="noreferrer">
        GitHub
      </a>
      <a href="/llms.txt">llms.txt</a>
    </nav>
  );
}
