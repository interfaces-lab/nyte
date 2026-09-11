import { ThemeProvider } from "next-themes";
import { CloudFrame } from "~/components/cloud/shell/frame";
import { cloudNavGroups } from "~/lib/cloud-nav";
import "./cloud.css";

/*
 * Cloud's own chrome. next-themes writes the same `.dark` class and storage
 * key the rest of the site uses, so the theme carries across /docs and
 * /cloud, while nothing from Fumadocs' layouts renders here.
 */
export default function Layout({ children }: LayoutProps<"/cloud">) {
  return (
    <ThemeProvider attribute="class" disableTransitionOnChange>
      <CloudFrame groups={cloudNavGroups()}>{children}</CloudFrame>
    </ThemeProvider>
  );
}
