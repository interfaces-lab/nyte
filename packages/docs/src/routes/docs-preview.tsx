import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NyteWordmark } from "~/components/brand/mark";
import { AsciiMoon } from "~/components/landing/hero-5/ascii-moon";
import { CoreGrid } from "~/components/landing/hero-5/core-mosaic";
import { brandTileClass } from "~/components/landing/hero-5/section";
import { SiteMobileNav } from "~/components/site-nav/mobile-menu";
import { ThemeToggle } from "~/components/site-nav/theme-toggle";
import { docsNav } from "~/lib/docs";
import { pageHead } from "~/lib/seo";
import { githubUrl } from "~/lib/shared";

export const Route = createFileRoute("/docs-preview")({
  head: () => pageHead({ noindex: true, nofollow: true }),
  component: () => (
    <DocsPreviewLayout>
      <DocsPreviewPage />
    </DocsPreviewLayout>
  ),
});

const purpose = "An open source agent core, built like git. Run it on your laptop or at the edge.";

function DocsPreviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-background/90 px-6 backdrop-blur-xl lg:hidden">
        <Link to="/" aria-label="Nyte, home">
          <NyteWordmark size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SiteMobileNav docs={docsNav} site={[]} githubHref={githubUrl} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[calc(300px+64px+848px+64px)] lg:grid lg:grid-cols-[300px_minmax(0,848px)] lg:gap-16 lg:px-8">
        <aside className="sticky top-0 hidden h-svh flex-col justify-between py-25 lg:flex">
          <div className="flex flex-col gap-8">
            <Link to="/" aria-label="Nyte, home" className="w-fit">
              <NyteWordmark size={22} />
            </Link>
            <p className="text-balance text-muted-foreground">{purpose}</p>
            <nav aria-label="Docs" className="flex flex-col gap-5 text-lg/none">
              {docsNav.map(({ label, items: [first] }) => (
                <Link
                  key={first.href}
                  to={first.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {label ?? "Get started"}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <a href={githubUrl} className="hover:text-foreground">
              GitHub
            </a>
            <ThemeToggle />
          </div>
        </aside>

        <main className="min-w-0 px-6 pt-6 pb-24 lg:px-0 lg:pt-25 lg:pb-50">{children}</main>
      </div>
    </>
  );
}

function DocsPreviewPage() {
  return (
    <div className="flex flex-col gap-12">
      <a
        href={githubUrl}
        aria-label="Nyte on GitHub, MIT license"
        className={`group/nyte flex aspect-video flex-col justify-between p-6 ${brandTileClass}`}
      >
        <AsciiMoon className="w-1/4 self-end transition-transform duration-500 ease-nav group-hover/nyte:-translate-y-1 motion-reduce:transition-none" />
        <span>
          <span className="block text-[15px]/5 font-medium">Nyte</span>
          <span className="block font-mono text-[11px]/4 text-white/70">MIT · GitHub</span>
        </span>
      </a>

      <section aria-labelledby="cores-title" className="flex flex-col gap-6">
        <CoreGrid />
        <div className="flex flex-col gap-2">
          <h2 id="cores-title" className="leading-[18px] font-medium">
            Countless cores.
          </h2>
          <p className="text-sm/[22px] text-muted-foreground">
            Each one fits the harness it was written for.
          </p>
        </div>
      </section>
    </div>
  );
}
