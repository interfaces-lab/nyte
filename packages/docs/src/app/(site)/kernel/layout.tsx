import { kernelNavGroups } from "~/lib/kernel-nav";
import { DocFrame } from "../_layout/frame";
import "./kernel.css";

export default function Layout({ children }: LayoutProps<"/kernel">) {
  return (
    <DocFrame label="Kernel" groups={kernelNavGroups()}>
      {children}
    </DocFrame>
  );
}
