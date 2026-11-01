import { Link } from "@tanstack/react-router";
import { pageSlug, type CatalogEntry } from "~/lib/design-catalog";
import { Specimen } from "./specimens";

/**
 * One catalogue cell: the page's name, number and summary, under its live
 * specimen. The caption comes first so the link leads the tab order; a
 * backdrop link fills the canvas around the specimen, whose own controls
 * stay usable.
 */
export function SpecimenTile({ entry }: { entry: CatalogEntry }) {
  const slug = pageSlug(entry.page);

  return (
    <article className="design-tile">
      <div className="design-tile-caption">
        <h3 className="design-tile-name">
          <Link to={entry.page.url}>{entry.page.title}</Link>
        </h3>
        <span className="design-tile-number" aria-hidden="true">
          {entry.number}
        </span>
        {entry.page.description ? (
          <p className="design-tile-text">{entry.page.description}</p>
        ) : null}
      </div>
      <div className="design-tile-canvas design-canvas">
        <Link
          to={entry.page.url}
          className="design-tile-backdrop"
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="design-specimen">
          <Specimen slug={slug} />
        </div>
      </div>
    </article>
  );
}
