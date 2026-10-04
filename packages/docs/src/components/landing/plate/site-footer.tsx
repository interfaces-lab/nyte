import Link from "next/link";
import { cloudNavGroups } from "~/lib/cloud-nav";
import { docsNavGroups } from "~/lib/docs-nav";
import { releasesUrl } from "~/lib/releases";
import { githubUrl } from "~/lib/shared";

const linkClass =
  "rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--site-panel)";

export function SiteFooter() {
  const columns = [
    {
      label: "Nyte",
      links: [
        { title: "Download", href: "#install" },
        { title: "Releases", href: releasesUrl },
        { title: "GitHub", href: githubUrl },
        { title: "llms.txt", href: "/llms.txt" },
      ],
    },
    { label: "Docs", links: docsNavGroups().flatMap((group) => group.items) },
    {
      label: "Cloud",
      links: cloudNavGroups().flatMap((group) => {
        const [first] = group.items;
        return first ? [{ title: group.label || first.title, href: first.href }] : [];
      }),
    },
  ];

  return (
    <footer className="relative isolate mx-(--plate-inset) mb-(--plate-inset) overflow-hidden rounded-(--plate-radius) bg-(--site-panel) after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle">
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-20 sm:pt-24">
        <nav aria-label="Sitemap" className="flex flex-wrap gap-x-16 gap-y-10">
          {columns.map((column) => (
            <div key={column.label} className="min-w-28">
              <h2 className="text-[13px]/5 text-tertiary-foreground">{column.label}</h2>
              <ul className="mt-3 flex flex-col gap-2 text-[15px]/6">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("/") || link.href.startsWith("#") ? (
                      <Link href={link.href} className={linkClass}>
                        {link.title}
                      </Link>
                    ) : (
                      <a href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
                        {link.title}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <svg
          aria-hidden="true"
          viewBox="0 0 1000 351"
          className="mt-20 block w-full text-foreground opacity-[0.14] select-none sm:mt-28 dark:opacity-[0.16]"
        >
          <defs>
            <pattern id="footer-scanlines" width="8" height="9" patternUnits="userSpaceOnUse">
              <rect width="8" height="3" fill="currentColor" />
            </pattern>
          </defs>
          <text
            x="-35.3"
            y="351"
            textLength="1036"
            lengthAdjust="spacing"
            fill="url(#footer-scanlines)"
            className="font-sans text-[482.5px] font-semibold tracking-[-0.04em]"
          >
            Nyte
          </text>
        </svg>
      </div>
    </footer>
  );
}
