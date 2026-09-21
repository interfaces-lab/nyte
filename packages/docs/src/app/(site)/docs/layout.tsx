import { ShellFrame } from "~/components/shell/frame";
import { docsNavGroups } from "~/lib/docs-nav";
import "~/shell.css";
import "./docs.css";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <ShellFrame skin="docs" label="Docs" groups={docsNavGroups()}>
      {children}
    </ShellFrame>
  );
}
