import Link from "next/link";
import { NyteWordmark } from "@/components/brand/mark";
import { gitConfig } from "@/lib/shared";

const source = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const columns = [
  {
    heading: "Design",
    links: [
      { label: "The whole shape", href: "/docs/design" },
      { label: "The four authorities", href: "/docs/design#the-four-authorities" },
      { label: "Heads", href: "/docs/design#heads-are-named-refs" },
      { label: "The turn", href: "/docs/design#the-turn" },
      { label: "Invariants", href: "/docs/design#invariants" },
    ],
  },
  {
    heading: "Surface",
    links: [
      { label: "Desktop", href: "/docs/desktop" },
      { label: "The SDK", href: "/docs/sdk" },
      { label: "Deployment", href: "/docs/design#deployment" },
      { label: "Plugins", href: "/docs/design#plugins" },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "Docs", href: "/docs/design" },
      { label: "Source", href: source, external: true },
      { label: "llms.txt", href: "/llms.txt", external: true },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="foot">
      <div className="site-container foot-inner">
        {columns.map((column) => (
          <div key={column.heading} className="foot-col">
            <h2>{column.heading}</h2>
            {column.links.map((link) =>
              "external" in link && link.external ? (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ) : (
                <Link key={link.label} href={link.href}>
                  {link.label}
                </Link>
              ),
            )}
          </div>
        ))}

        <Link href="/" aria-label="Nyte, home" className="foot-brand">
          <NyteWordmark size={15} />
        </Link>
      </div>
    </footer>
  );
}
