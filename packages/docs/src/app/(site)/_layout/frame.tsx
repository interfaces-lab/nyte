import type { ReactNode } from "react";
import type { NavGroup } from "~/lib/nav";
import { Sidebar } from "./sidebar";
import "./layout.css";

/* The docs frame under the site nav: sidebar, then the page. */
export function DocFrame({ groups, children }: { groups: NavGroup[]; children: ReactNode }) {
  return (
    <div className="doc flex min-w-0 flex-1 flex-col">
      <div className="doc-frame">
        <Sidebar groups={groups} />
        {children}
      </div>
    </div>
  );
}
