import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { NavGroup } from "~/lib/nav";
import { shell, withShell, type ShellSkin } from "~/shell.stylex";
import { ShellSidebar } from "./sidebar";

export function ShellFrame({
  skin,
  label,
  groups,
  children,
}: {
  skin: ShellSkin;
  label: string;
  groups: NavGroup[];
  children: ReactNode;
}) {
  return (
    <div {...withShell(`shell ${skin}`, stylex.props(shell.fillLock))}>
      <div className="shell-frame">
        <ShellSidebar label={label} groups={groups} />
        {children}
      </div>
    </div>
  );
}
