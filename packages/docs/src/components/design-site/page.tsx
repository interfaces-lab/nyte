import { Link } from "@tanstack/react-router";
import { mdxComponents } from "~/components/mdx";
import { findEntry, pageSlug } from "~/lib/design-catalog";
import type { DocPage, NavItem } from "~/lib/docs";
import { DesignMain } from "./shell";
import { Specimen, hasSpecimen } from "./specimens";

export function DesignPageView({ page }: { page: DocPage }) {
  const entry = findEntry(page.url);
  const slug = pageSlug(page);
  const portrait = entry !== undefined && hasSpecimen(slug);

  return (
    <DesignMain>
      <header className="design-head" data-portrait={portrait || undefined}>
        <div className="design-head-index">
          {entry ? (
            <span className="design-head-count">
              <span className="design-head-number">{entry.number}</span>
              <span className="design-head-total">/{entry.total}</span>
            </span>
          ) : null}
          <span className="design-head-section">{page.section}</span>
        </div>
        <div className="design-head-text">
          <h1 className="design-title">{page.title}</h1>
          {page.description ? <p className="design-lede">{page.description}</p> : null}
        </div>
        {portrait ? (
          <div className="design-head-portrait design-canvas">
            <div className="design-specimen">
              <Specimen slug={slug} />
            </div>
          </div>
        ) : null}
      </header>
      <article className="design-article doc-prose">
        <page.Body components={mdxComponents} />
      </article>
      {page.previous || page.next ? (
        <nav className="design-pager" aria-label="Pages">
          <PagerLink target={page.previous} dir="previous" />
          <PagerLink target={page.next} dir="next" />
        </nav>
      ) : null}
    </DesignMain>
  );
}

function PagerLink({ target, dir }: { target?: NavItem; dir: "previous" | "next" }) {
  if (!target) return <span className="design-pager-blank" />;
  const entry = findEntry(target.href);

  return (
    <Link to={target.href} className="design-pager-link" data-dir={dir}>
      <span className="design-pager-dir">{dir === "previous" ? "Previous" : "Next"}</span>
      <span className="design-pager-title">
        {entry ? <span className="design-pager-number">{entry.number}</span> : null}
        {target.title}
      </span>
    </Link>
  );
}
