import * as stylex from "@stylexjs/stylex";
import { NextProvider } from "fumadocs-core/framework/next";
import { ThemeProvider } from "next-themes";
import { SiteNav } from "~/components/site-nav";
import { shell } from "~/shell.stylex";

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
        <div {...stylex.props(shell.fillScroll)}>{children}</div>
      </ThemeProvider>
    </NextProvider>
  );
}
