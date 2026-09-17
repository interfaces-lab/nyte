"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "~/lib/nav";
import { shell, withShell, type ShellSkin } from "~/shell.stylex";
import { ShellColumnBody } from "./column";

export function ShellSidebar({
  skin,
  label,
  groups,
}: {
  skin: ShellSkin;
  label: string;
  groups: NavGroup[];
}) {
  const pathname = usePathname();

  return (
    <nav {...withShell(`${skin}-side`, stylex.props(shell.columnWrap))} aria-label={label}>
      <ShellColumnBody>
        {groups.map((group) => (
          <div key={group.label || "root"} className={`${skin}-side-group`}>
            {group.label ? <p className={`${skin}-side-label`}>{group.label}</p> : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`${skin}-side-row`}
                    aria-current={pathname === item.href ? "page" : undefined}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </ShellColumnBody>
    </nav>
  );
}
