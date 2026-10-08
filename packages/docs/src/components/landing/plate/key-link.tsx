"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

interface KeyLinkProps {
  href: string;
  shortcut: string;
  className: string;
  kbdClassName: string;
  children: ReactNode;
}

/* A link that also follows its letter key, unless the user is typing. */
export function KeyLink({ href, shortcut, className, kbdClassName, children }: KeyLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat)
        return;
      if (event.key.toLowerCase() !== shortcut.toLowerCase()) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [role=dialog]"))
      )
        return;
      event.preventDefault();
      ref.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return (
    <Link ref={ref} href={href} aria-keyshortcuts={shortcut} className={className}>
      {children}
      <kbd aria-hidden="true" className={kbdClassName}>
        {shortcut}
      </kbd>
    </Link>
  );
}
