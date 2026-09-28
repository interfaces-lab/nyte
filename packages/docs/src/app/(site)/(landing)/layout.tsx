/*
 * The landing surface shares the site navbar from the root layout and adds
 * nothing above the content. It is not wrapped in Fumadocs' HomeLayout: that
 * layout's job is a navbar, and the navbar already exists.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-w-0 grow flex-col">
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
