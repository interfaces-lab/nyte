import { NextProvider } from "fumadocs-core/framework/next";
import { ThemeProvider } from "next-themes";
import { SiteNav } from "~/components/site-nav/site-nav";

/* One navbar for every page. The document scrolls; the bar sticks at one offset. */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <NextProvider>
      <ThemeProvider attribute="class" disableTransitionOnChange enableColorScheme>
        <SiteNav />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </ThemeProvider>
    </NextProvider>
  );
}
