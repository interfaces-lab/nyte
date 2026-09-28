import type { ReactNode } from "react";

/*
 * The glass rim every host sits in on the plate. It is open at the bottom:
 * the plate's edge cuts each frame, so a host fills its stage to the floor.
 */
export function Bezel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-t-[20px] bg-white/30 p-1.5 pb-0 shadow-[0_40px_90px_-30px_rgb(6_6_70/0.65)] ring-1 ring-white/40 ring-inset backdrop-blur-md dark:bg-white/[0.06] dark:ring-white/10 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
