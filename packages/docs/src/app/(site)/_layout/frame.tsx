import type { ReactNode } from "react";
import type { NavGroup } from "~/lib/nav";
import { Sidebar } from "./sidebar";
import "./layout.css";

/* The frame /docs and /cloud share under the site nav: sidebar, then the page. */
export function DocFrame({
  label,
  groups,
  children,
}: {
  label: string;
  groups: NavGroup[];
  children: ReactNode;
}) {
  return (
    <div className="doc flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="doc-frame">
        <Sidebar label={label} groups={groups} />
        {children}
      </div>
    </div>
  );
}
