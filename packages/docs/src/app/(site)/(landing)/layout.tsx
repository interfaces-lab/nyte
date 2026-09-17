import * as stylex from "@stylexjs/stylex";
import { LandingFooter } from "~/components/landing/landing-footer";
import { shell, withShell } from "~/shell.stylex";

/*
 * The landing surface shares the site navbar from the root layout and adds
 * nothing above the content. It is not wrapped in Fumadocs' HomeLayout: that
 * layout's job is a navbar, and the navbar already exists.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <div {...withShell("landing", stylex.props(shell.fill))}>
      <main className="site-container min-w-0 flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
