import { Link } from "@tanstack/react-router";
import type { NavSection } from "~/lib/docs";

export function Sidebar({ sections }: { sections: readonly NavSection[] }) {
  return (
    <nav className="doc-side hidden flex-col lg:flex gap-6 text-[14px]/5" aria-label="Docs">
      {sections.map((section) => (
        <div key={section.label ?? section.items[0].href}>
          {section.label ? (
            <h2 className="pb-2 font-normal text-tertiary-foreground">{section.label}</h2>
          ) : null}
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className="block py-1 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                  activeOptions={{ exact: true }}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
