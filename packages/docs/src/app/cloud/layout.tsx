import { ThemeProvider } from "next-themes";
import { SiteNav } from "~/components/site-nav";
import { ShellFrame } from "~/components/shell/frame";
import { cloudNavGroups } from "~/lib/cloud-nav";
import "./cloud.css";

/*
 * Same SiteNav as landing and /docs. Cloud owns the page below the bar.
 * The unlabeled opening group shows as "Overview" in the rail.
 */
export default function Layout({ children }: LayoutProps<"/cloud">) {
  const groups = cloudNavGroups().map((group) =>
    group.label === "" ? { ...group, label: "Overview" } : group,
  );
  return (
    <ThemeProvider attribute="class" disableTransitionOnChange enableColorScheme>
      <SiteNav />
      <ShellFrame skin="cloud" label="Cloud" groups={groups}>
        {children}
      </ShellFrame>
    </ThemeProvider>
  );
}
