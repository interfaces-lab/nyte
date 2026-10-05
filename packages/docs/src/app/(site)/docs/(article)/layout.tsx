import { docsNavGroups } from "~/lib/docs-nav";
import { DocFrame } from "../_layout/frame";
import "./docs.css";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocFrame label="Docs" groups={docsNavGroups()}>
      {children}
    </DocFrame>
  );
}
