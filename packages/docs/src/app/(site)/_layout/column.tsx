import type { ReactNode } from "react";

/* A locked column: its own scroll area with a fade over the bottom edge. */
export function Column({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="doc-scroll h-full min-h-0 min-w-0 scroll-pb-18 overflow-y-auto overscroll-contain">
        {children}
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-18 bg-linear-to-t from-(--nyte-bg-base) from-[12px] to-transparent"
        aria-hidden
      />
    </>
  );
}
