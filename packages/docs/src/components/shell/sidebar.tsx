"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "~/lib/nav";
import { shell, withShell } from "~/shell.stylex";
import { ShellColumnBody } from "./column";

export function ShellSidebar({ label, groups }: { label: string; groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav {...withShell("shell-side", stylex.props(shell.columnWrap))} aria-label={label}>
      <ShellColumnBody>
        {groups.map((group) => (
          <div key={group.label || "root"} className="shell-side-group">
            {group.label ? <p className="shell-side-label">{group.label}</p> : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="shell-side-row"
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
