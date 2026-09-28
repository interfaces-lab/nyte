import { NextProvider } from "fumadocs-core/framework/next";
import { ThemeProvider } from "next-themes";
import { SiteNav } from "~/components/site-nav/site-nav";

/*
 * Marketing and core docs share one navbar. Search is a client island.
 * Cloud mounts the same SiteNav in its own layout so the bar does not
 * change between products. The fill region is the leftover 100svh under
 * the bar; landing scrolls here, docs locks and scrolls the article.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <NextProvider>
      <ThemeProvider attribute="class" disableTransitionOnChange enableColorScheme>
        <SiteNav />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </ThemeProvider>
    </NextProvider>
  );
}
