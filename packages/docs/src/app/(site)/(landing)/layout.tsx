import { LandingFooter } from "~/components/landing/landing-footer";

/*
 * The landing surface shares the site navbar from the root layout and adds
 * nothing above the content. It is not wrapped in Fumadocs' HomeLayout: that
 * layout's job is a navbar, and the navbar already exists.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <div className="landing flex min-h-screen flex-col">
      <main className="site-container flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
