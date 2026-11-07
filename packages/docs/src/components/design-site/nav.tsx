import { Link, useLocation, useMatchRoute } from "@tanstack/react-router";
import { useState } from "react";
import { HeadingSpy } from "~/components/site/sidebar";
import { catalog } from "~/lib/design-catalog";
import { designNav, findPage } from "~/lib/docs";

export function DesignNav({ onNavigate }: { onNavigate?: () => void }) {
  const matchRoute = useMatchRoute();
  const pathname = useLocation({ select: (location) => location.pathname });
  const toc = findPage(pathname)?.toc.filter((entry) => entry.depth === 2) ?? [];
  const [current, setCurrent] = useState<string | null>(null);

  return (
    <nav aria-label="Design" className="design-nav">
      <HeadingSpy key={toc.map((entry) => entry.url).join(" ")} toc={toc} onPass={setCurrent} />
      {designNav.flatMap((section) => {
        if (!section.label) return [];
        const count = catalog.find((entry) => entry.label === section.label)?.entries.length;

        return [
          <div key={section.label} className="design-nav-section">
            <h2 className="design-nav-label">
              <span>{section.label}</span>
              {count ? <span className="design-nav-count">{count}</span> : null}
            </h2>
            <ul>
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    className="design-nav-link"
                    activeOptions={{ exact: true }}
                    onClick={onNavigate}
                  >
                    {item.title}
                  </Link>
                  {toc.length > 0 && matchRoute({ to: item.href }) !== false ? (
                    <ol className="design-nav-toc" aria-label="On this page">
                      {toc.map((entry, index) => (
                        <li key={entry.url}>
                          <a
                            href={entry.url}
                            aria-current={current === entry.url ? "location" : undefined}
                            onClick={onNavigate}
                          >
                            <span className="design-nav-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            {entry.title}
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>,
        ];
      })}
    </nav>
  );
}
