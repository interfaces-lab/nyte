import { cloudNavGroups } from "~/lib/cloud-nav";
import { DocFrame } from "../_layout/frame";
import "./cloud.css";

export default function Layout({ children }: LayoutProps<"/cloud">) {
  return (
    <DocFrame label="Cloud" groups={cloudNavGroups()}>
      {children}
    </DocFrame>
  );
}
