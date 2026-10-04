"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface FactWordProps {
  href: string;
  above: string;
  below: string;
  /** Tailwind class setting --tint, the pill and hover colour. */
  tint: string;
  children: ReactNode;
}

/* A word in the sentence that, on hover or focus, throws two facts about itself and lets them drift with the pointer. */
export function FactWord({ href, above, below, tint, children }: FactWordProps) {
  return (
    <Link
      href={href}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--px",
          `${event.clientX - box.left - box.width / 2}px`,
        );
      }}
      onPointerLeave={(event) => event.currentTarget.style.setProperty("--px", "0px")}
      className={`fact relative whitespace-nowrap text-white underline decoration-white/40 decoration-dotted underline-offset-[5px] outline-none transition-colors duration-150 hover:text-(--tint) hover:decoration-(--tint) focus-visible:text-(--tint) focus-visible:decoration-(--tint) ${tint}`}
    >
      {children}
      <span
        aria-hidden="true"
        className="fact-pill bottom-full mb-0.5 [--dx:-22%] [--dy-rest:8px] [--r:-7deg]"
      >
        {above}
      </span>
      <span
        aria-hidden="true"
        className="fact-pill top-full mt-1 [--dx:14%] [--dy-rest:-8px] [--r:5deg]"
      >
        {below}
      </span>
    </Link>
  );
}
