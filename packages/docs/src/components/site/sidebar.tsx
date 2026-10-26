import { Link, useMatchRoute } from "@tanstack/react-router";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useState } from "react";
import type { ReactNode } from "react";
import type { NavSection } from "~/lib/docs";

export interface TocEntry {
  title: ReactNode;
  url: string;
  depth: number;
}

/**
 * The docs tree, beside the page and in the phone menu. Rows are the site
 * nav's pills: its control height, its inset, its fill for the current page.
 * The current page's sections branch beneath its row, and the one most
 * recently scrolled past the top third of the viewport is lit, so the mark
 * moves as you read.
 */
export function DocNav({
  sections,
  toc,
  className,
  onNavigate,
}: {
  sections: readonly NavSection[];
  toc: readonly TocEntry[];
  className: string;
  onNavigate?: () => void;
}) {
  const matchRoute = useMatchRoute();
  const [current, setCurrent] = useState<string | null>(null);

  return (
    <nav className={className} aria-label="Docs">
      <HeadingSpy key={toc.map((entry) => entry.url).join(" ")} toc={toc} onPass={setCurrent} />
      {sections.map((section) => (
        <div key={section.label ?? section.items[0].href}>
          {section.label ? (
            <h2 className="px-2.5 pb-1 font-normal text-tertiary-foreground">{section.label}</h2>
          ) : null}
          <ul className="flex flex-col gap-px">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className="block rounded-full px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground aria-[current=page]:bg-foreground/10 aria-[current=page]:text-foreground"
                  activeOptions={{ exact: true }}
                  onClick={onNavigate}
                >
                  {item.title}
                </Link>
                {toc.length > 0 && matchRoute({ to: item.href }) !== false ? (
                  <ul className="doc-side-branches" aria-label="On this page">
                    {toc.map((entry) => (
                      <li key={entry.url} className="doc-side-branch">
                        <a
                          href={entry.url}
                          aria-current={current === entry.url ? "location" : undefined}
                          onClick={onNavigate}
                        >
                          {entry.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Remounts per toc, so a new page's headings are picked as soon as it renders. */
function HeadingSpy(props: { toc: readonly TocEntry[]; onPass: (url: string) => void }) {
  useMountEffect(() => {
    const pick = () => {
      const headings = props.toc.flatMap((entry) => {
        const heading = document.getElementById(entry.url.slice(1));

        return heading === null ? [] : [heading];
      });

      if (headings.length === 0) return;

      const line = window.innerHeight / 3;
      const passed = headings.findLast((heading) => heading.getBoundingClientRect().top <= line);

      props.onPass(`#${(passed ?? headings[0]).id}`);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true, capture: true });
    window.addEventListener("resize", pick);

    return () => {
      window.removeEventListener("scroll", pick, { capture: true });
      window.removeEventListener("resize", pick);
    };
  });

  return null;
}
