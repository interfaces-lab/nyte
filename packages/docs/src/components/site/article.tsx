import { Link } from "@tanstack/react-router";
import { use } from "react";
import type { ReactNode } from "react";
import type { NavItem } from "~/lib/docs";
import { DocSections } from "./frame";
import { DocNav, type TocEntry } from "./sidebar";

function PagerLink({ target, dir }: { target?: NavItem; dir: "previous" | "next" }) {
  if (!target) return null;

  return (
    <Link to={target.href} data-dir={dir}>
      <span className="doc-eyebrow">{dir === "previous" ? "Previous" : "Next"}</span>
      <strong>{target.title}</strong>
    </Link>
  );
}

/**
 * One doc page: the frame's sidebar with this page's sections under its row,
 * then eyebrow, title, lede, and any header actions, the prose, and the pager.
 */
export function DocArticle({
  eyebrow,
  title,
  lede,
  actions,
  toc,
  previous,
  next,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  toc: TocEntry[];
  previous?: NavItem;
  next?: NavItem;
  children: ReactNode;
}) {
  return (
    <>
      <DocNav
        className="doc-side hidden flex-col gap-5 text-sm/5 lg:flex"
        sections={use(DocSections)}
        toc={toc.filter((entry) => entry.depth === 2)}
      />
      <main className="doc-main min-w-0">
        <article className="doc-article">
          <header className="doc-head">
            {eyebrow ? <span className="doc-eyebrow">{eyebrow}</span> : null}
            <h1 className="doc-title">{title}</h1>
            {lede ? <p className="doc-lede">{lede}</p> : null}
            {actions}
          </header>
          <div className="doc-prose">{children}</div>
          {previous || next ? (
            <nav className="doc-pager" aria-label="Pages">
              <PagerLink target={previous} dir="previous" />
              <PagerLink target={next} dir="next" />
            </nav>
          ) : null}
        </article>
      </main>
    </>
  );
}
