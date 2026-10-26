import { HrefLink } from "~/components/site/href-link";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useEffectEvent, useRef, type ReactNode } from "react";

interface KeyLinkProps {
  href: string;
  shortcut: string;
  className: string;
  kbdClassName: string;
  children: ReactNode;
}

/** A link that also follows its letter key, unless the user is typing. */
export function KeyLink({ href, shortcut, className, kbdClassName, children }: KeyLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
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
  });

  useMountEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <HrefLink ref={ref} href={href} aria-keyshortcuts={shortcut} className={className}>
      {children}
      <kbd aria-hidden="true" className={kbdClassName}>
        {shortcut}
      </kbd>
    </HrefLink>
  );
}
