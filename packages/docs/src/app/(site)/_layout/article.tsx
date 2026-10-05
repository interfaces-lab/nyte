import Link from "next/link";
import type { ReactNode } from "react";
import { Toc, type TocEntry } from "./toc";

interface PagerTarget {
  name?: unknown;
  url: string;
}

function PagerLink({ target, dir }: { target?: PagerTarget; dir: "previous" | "next" }) {
  if (!target || typeof target.name !== "string") return null;
  return (
    <Link href={target.url} data-dir={dir}>
      <span className="doc-eyebrow">{dir === "previous" ? "Previous" : "Next"}</span>
      <strong>{target.name}</strong>
    </Link>
  );
}

/*
 * One doc page: eyebrow, title, lede, and any header actions, then the
 * prose, the pager, and the on-this-page rail.
 */
export function DocArticle({
  eyebrow,
  title,
  lede,
  actions,
  aside,
  toc,
  previous,
  next,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Sits under the on-this-page list. */
  aside?: ReactNode;
  toc: TocEntry[];
  previous?: PagerTarget;
  next?: PagerTarget;
  children: ReactNode;
}) {
  return (
    <>
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
      <Toc entries={toc.filter((entry) => entry.depth <= 3)} aside={aside} />
    </>
  );
}
