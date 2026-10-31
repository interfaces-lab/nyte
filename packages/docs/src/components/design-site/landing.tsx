import { Toaster } from "@nyte-ai/ui/toast";
import { mdxComponents } from "~/components/mdx";
import { catalog, pageSlug } from "~/lib/design-catalog";
import type { DocPage } from "~/lib/docs";
import { DesignMain } from "./shell";
import { wideSpecimens } from "./specimens";
import { SpecimenTile } from "./tile";

const sectionNotes = new Map([
  ["Foundations", "Colour, shape, space, type, elevation, and motion, drawn from the live tokens."],
  [
    "Components",
    "Every import path in the package, rendered live. Each page covers usage, anatomy, examples, props, and accessibility.",
  ],
]);

/**
 * design.nyte.sh/: the name and what the package is, then each section of the
 * catalogue as a sheet of numbered, working specimens.
 */
export function DesignLanding({ page }: { page: DocPage }) {
  const counts = catalog.map(
    (section) => `${section.entries.length} ${section.label.toLowerCase()}`,
  );

  return (
    <DesignMain>
      <section className="design-hero" aria-labelledby="design-title">
        <h1 id="design-title" className="design-hero-title">
          <span>Nyte</span> <span>Design</span>
        </h1>
        <div className="design-hero-text">
          {page.description ? <p className="design-hero-lede">{page.description}.</p> : null}
          <div className="design-hero-body doc-prose">
            <page.Body components={mdxComponents} />
          </div>
          <p className="design-hero-facts">
            {counts.map((count) => (
              <span key={count}>{count}</span>
            ))}
            <span>light and dark</span>
          </p>
        </div>
      </section>
      {catalog.map((section, index) => {
        const id = `sheet-${section.label.toLowerCase()}`;

        return (
          <section key={section.label} className="design-sheet" aria-labelledby={id}>
            <header className="design-sheet-head">
              <span className="design-sheet-number">{String(index + 1).padStart(2, "0")}</span>
              <h2 id={id} className="design-sheet-title">
                {section.label}
              </h2>
              {sectionNotes.has(section.label) ? (
                <p className="design-sheet-note">{sectionNotes.get(section.label)}</p>
              ) : null}
            </header>
            <ul className="design-tiles">
              {section.entries.map((entry) => (
                <li
                  key={entry.page.url}
                  className="design-tiles-item"
                  data-wide={wideSpecimens.has(pageSlug(entry.page)) || undefined}
                >
                  <SpecimenTile entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Toaster />
    </DesignMain>
  );
}
