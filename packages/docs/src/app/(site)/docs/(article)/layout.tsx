import { navGroups } from "~/lib/nav";
import { DocFrame } from "../../_layout/frame";
import "../docs.css";
import "../kernel.css";
import "../components.css";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return <DocFrame groups={navGroups()}>{children}</DocFrame>;
}
