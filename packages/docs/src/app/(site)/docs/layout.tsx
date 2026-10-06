import { docsNav } from "~/lib/docs";
import { DocFrame } from "../_layout/frame";
import "./docs.css";
import "./kernel.css";
import "./components.css";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return <DocFrame sections={docsNav}>{children}</DocFrame>;
}
