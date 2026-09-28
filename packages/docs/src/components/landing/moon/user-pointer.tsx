"use client";

import { IconCollaborationPointerLeft } from "central-icons-filled";
import { useEffect, useRef } from "react";

/*
 * Your own pointer matches the others on the page. CSS cursors need an image,
 * so the real icon renders once off-screen and its markup becomes a data URI
 * on the hero. The tip of the icon sits at about (4, 4) in its 24px box.
 */
export function UserPointer() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const holder = ref.current;
    const svg = holder?.querySelector("svg");
    const hero = holder?.closest<HTMLElement>(".hero-plate");
    if (!svg || !hero) return;
    hero.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}") 4 4, auto`;
    return () => {
      hero.style.cursor = "";
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed -top-10 -left-10 opacity-0"
    >
      <IconCollaborationPointerLeft size={24} color="#ffffff" />
    </span>
  );
}
