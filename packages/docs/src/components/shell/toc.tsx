"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { shell, withShell } from "~/shell.stylex";
import { ShellColumnBody } from "./column";

export interface TocEntry {
  title: ReactNode;
  url: string;
  depth: number;
}

/*
 * On-this-page rail. The current heading is whichever one most recently
 * crossed the top third of the viewport, so the mark moves as you read, not
 * only when a heading enters view.
 */
export function ShellToc({ entries }: { entries: TocEntry[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const headings = entries
      .map((entry) => document.getElementById(entry.url.slice(1)))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    const pick = () => {
      const line = window.innerHeight / 3;
      let chosen = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) chosen = heading;
      }
      setCurrent(chosen?.id ?? null);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div {...withShell("shell-toc", stylex.props(shell.columnWrap))}>
        <ShellColumnBody>{null}</ShellColumnBody>
      </div>
    );
  }

  return (
    <aside {...withShell("shell-toc", stylex.props(shell.columnWrap))} aria-label="On this page">
      <ShellColumnBody>
        <span className="shell-eyebrow">On this page</span>
        <ol>
          {entries.map((entry) => (
            <li key={entry.url}>
              <a
                href={entry.url}
                data-depth={entry.depth}
                aria-current={current === entry.url.slice(1) ? "true" : undefined}
              >
                {entry.title}
              </a>
            </li>
          ))}
        </ol>
      </ShellColumnBody>
    </aside>
  );
}
