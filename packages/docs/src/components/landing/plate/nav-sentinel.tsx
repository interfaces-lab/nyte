"use client";

import { useEffect, useRef } from "react";

/*
 * Sits on the top edge of the preview. Once that edge passes under the nav,
 * the document is marked and the nav leaves the plate's white for a frosted bar.
 */
export function NavSentinel() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const sentinel = ref.current;
    if (!sentinel) return;
    const root = document.documentElement;
    const navBottom = Math.round(
      document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
    );

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        root.toggleAttribute(
          "data-nav-stuck",
          !entry.isIntersecting && entry.boundingClientRect.top < navBottom,
        );
      },
      { rootMargin: `-${navBottom}px 0px 0px 0px` },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      root.removeAttribute("data-nav-stuck");
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-px"
    />
  );
}
