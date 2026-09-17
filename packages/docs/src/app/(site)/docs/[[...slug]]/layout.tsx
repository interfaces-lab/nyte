import { ShellFrame } from "~/components/shell/frame";
import { docsNavGroups } from "~/lib/docs-nav";

export default function Layout({ children }: LayoutProps<"/docs/[[...slug]]">) {
  return (
    <ShellFrame skin="docs" label="Docs" groups={docsNavGroups()}>
      {children}
    </ShellFrame>
  );
}
