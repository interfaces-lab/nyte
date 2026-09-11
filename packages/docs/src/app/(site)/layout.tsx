import { RootProvider } from "fumadocs-ui/provider/next";
import { SiteNav } from "~/components/site-nav";

/*
 * The marketing pages and the core docs share Fumadocs' provider (theme,
 * search dialog) and one navbar. Cloud lives outside this group with its own
 * chrome, so nothing Fumadocs draws reaches /cloud.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <RootProvider>
      <SiteNav />
      {children}
    </RootProvider>
  );
}
