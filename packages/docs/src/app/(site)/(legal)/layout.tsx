import type { ReactNode } from "react";
import { DocFrame } from "../_layout/frame";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocFrame
      groups={[
        {
          label: "Legal",
          items: [
            { title: "Privacy policy", href: "/privacy" },
            { title: "Terms of service", href: "/terms" },
          ],
        },
      ]}
    >
      {children}
    </DocFrame>
  );
}
