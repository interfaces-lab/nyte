import { useState } from "react";
import type { ReactElement, Ref } from "react";

export const SITE_URL = "https://orbit.dev/docs";

const CARDS = [
  ["Get started", "Deploy your first app in about five minutes."],
  ["Quickstart", "Connect a repository and ship a preview."],
  ["Concepts", "Environments, previews and promotions."],
  ["CLI reference", "Every command, flag and exit code."],
] as const;

const LINES = ["", "", "add", "add", "", "remove", "", ""] as const;

/** A third-party docs page. It keeps its own look in either appearance, as a real site would. */
export function OrbitSite({ rootRef }: { readonly rootRef: Ref<HTMLDivElement> }): ReactElement {
  const [banner, setBanner] = useState(true);

  return (
    <div
      ref={rootRef}
      className="orbit-site"
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a") !== null) {
          event.preventDefault();
        }
      }}
    >
      <header className="site-header flex">
        <a className="logo" href="#top">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="17" cy="6" r="3" fill="currentColor" />
          </svg>
          <span>ORBIT</span>
        </a>
        <nav className="header-actions flex" aria-label="Site">
          <button type="button" className="icon-button" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12.5 12.5 16 16" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button type="button" className="icon-button" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </nav>
      </header>
      <main className="docs">
        <p className="eyebrow">Get Started</p>
        <h1 className="title">Orbit Documentation</h1>
        <p className="lede">
          Orbit deploys web apps from a git push. Use it to preview every branch, promote a build to
          production, and roll back in one click when something breaks.
        </p>
        <figure className="hero" aria-label="The Orbit dashboard">
          <div className="hero-window">
            <div className="hero-sidebar">
              {LINES.slice(0, 6).map((_line, index) => (
                <span key={index} className="hero-line" />
              ))}
            </div>
            <div className="hero-editor">
              {LINES.map((line, index) => (
                <span key={index} className={line === "" ? "hero-line" : `hero-line ${line}`} />
              ))}
            </div>
          </div>
        </figure>
        <section className="start-here">
          <h2 className="section-title">Start here</h2>
          <div className="card-grid">
            {CARDS.map(([title, text]) => (
              <a key={title} className="card" href="#start">
                <span className="card-title">{title}</span>
                <span className="card-text">{text}</span>
              </a>
            ))}
          </div>
        </section>
        <section className="changelog">
          <h2 className="section-title">What&apos;s new</h2>
          <ul className="release-list">
            <li>
              <strong>Preview comments.</strong> Reviewers can pin a note to any element.
            </li>
            <li>
              <strong>Faster cold starts.</strong> Functions boot in under 80 ms.
            </li>
            <li>
              <strong>Branch protection.</strong> Promotions can require an approval.
            </li>
          </ul>
        </section>
      </main>
      {banner && (
        <aside className="cookie-banner" aria-label="Cookies">
          <p className="cookie-text">
            Essential cookies keep the site working. Optional cookies help with performance and
            advertising. Learn more in our <a href="#cookies">Cookie Policy</a>.
          </p>
          <button
            type="button"
            className="icon-button cookie-close"
            aria-label="Close"
            onClick={() => setBanner(false)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <div className="cookie-actions flex">
            <button type="button" className="btn btn-dark" onClick={() => setBanner(false)}>
              Reject All
            </button>
            <button type="button" className="btn btn-dark" onClick={() => setBanner(false)}>
              Accept All Cookies
            </button>
            <button type="button" className="btn">
              Cookies Settings
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
