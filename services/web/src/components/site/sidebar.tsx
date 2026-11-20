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

type Branch = { readonly href: string; readonly toc: readonly TocEntry[] };

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

  const open =
    toc.length === 0
      ? undefined
      : sections
          .flatMap((section) => section.items)
          .find((item) => matchRoute({ to: item.href }) !== false)?.href;

  const [shown, setShown] = useState<{
    readonly open: Branch | null;
    readonly closing: Branch | null;
    readonly moved: boolean;
  }>({ open: open === undefined ? null : { href: open, toc }, closing: null, moved: false });

  if ((shown.open?.href ?? undefined) !== open)
    setShown({
      open: open === undefined ? null : { href: open, toc },
      closing: shown.open,
      moved: true,
    });

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
                {item.href === open || item.href === shown.closing?.href ? (
                  <div
                    className="doc-side-branches"
                    data-state={item.href === open ? "open" : "closed"}
                    data-animate={shown.moved ? "" : undefined}
                    inert={item.href !== open}
                  >
                    <ul className="doc-side-branch-list" aria-label="On this page">
                      {(item.href === open ? toc : (shown.closing?.toc ?? [])).map((entry) => (
                        <li key={entry.url} className="doc-side-branch">
                          <a
                            href={entry.url}
                            aria-current={
                              item.href === open && current === entry.url ? "location" : undefined
                            }
                            onClick={onNavigate}
                          >
                            {entry.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function HeadingSpy(props: { toc: readonly TocEntry[]; onPass: (url: string) => void }) {
  useMountEffect(() => {
    let frame = 0;

    const pick = () => {
      frame = 0;

      const headings = props.toc.flatMap((entry) => {
        const heading = document.getElementById(entry.url.slice(1));

        return heading === null ? [] : [heading];
      });

      if (headings.length === 0) return;

      const line = window.innerHeight / 3;
      const passed = headings.findLast((heading) => heading.getBoundingClientRect().top <= line);

      props.onPass(`#${(passed ?? headings[0]).id}`);
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(pick);
    };

    pick();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  });

  return null;
}
