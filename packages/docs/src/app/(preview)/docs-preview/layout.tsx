import type { Metadata } from "next";
import Link from "next/link";
import { ThemeProvider } from "next-themes";
import { NyteWordmark } from "~/components/brand/mark";
import { SiteMobileNav } from "~/components/site-nav/mobile-menu";
import { ThemeToggle } from "~/components/site-nav/theme-toggle";
import { docsNav } from "~/lib/docs";
import { githubUrl } from "~/lib/shared";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const purpose = "An open source agent core, built like git. Run it on your laptop or at the edge.";

export default function Layout({ children }: LayoutProps<"/docs-preview">) {
  return (
    <ThemeProvider attribute="class" disableTransitionOnChange enableColorScheme>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-background/90 px-6 backdrop-blur-xl lg:hidden">
        <Link href="/" aria-label="Nyte, home">
          <NyteWordmark size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SiteMobileNav sections={docsNav} githubHref={githubUrl} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[calc(300px+64px+848px+64px)] lg:grid lg:grid-cols-[300px_minmax(0,848px)] lg:gap-16 lg:px-8">
        <aside className="sticky top-0 hidden h-svh flex-col justify-between py-25 lg:flex">
          <div className="flex flex-col gap-8">
            <Link href="/" aria-label="Nyte, home" className="w-fit">
              <NyteWordmark size={22} />
            </Link>
            <p className="text-balance text-muted-foreground">{purpose}</p>
            <nav aria-label="Docs" className="flex flex-col gap-5 text-lg/none">
              {docsNav.map(({ label, items: [first] }) => (
                <Link
                  key={first.href}
                  href={first.href}
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
    </ThemeProvider>
  );
}
