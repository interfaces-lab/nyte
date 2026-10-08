import type { ReactNode } from "react";

/*
 * The page's one surface language below the plate. Every tile is the same
 * panel with the same hairline; hover inverts it. Blue is kept for Nyte.
 */
export const tileClass =
  "rounded-[12px] bg-(--site-panel) ring-1 ring-border-subtle ring-inset outline-none transition-[background-color,color,opacity,scale] duration-300 ease-nav";

export const tileInvertClass =
  "hover:bg-foreground hover:text-background focus-visible:bg-foreground focus-visible:text-background";

export const brandTileClass =
  "rounded-[12px] bg-(--hero-blue) text-white outline-none transition-[background-color] duration-300 ease-nav hover:bg-[#2b2be6] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface SectionProps {
  id: string;
  title: string;
  line?: string;
  children: ReactNode;
}

export function Section({ id, title, line, children }: SectionProps) {
  return (
    <section
      aria-labelledby={id}
      className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-12">
        <h2
          id={id}
          className="font-display text-[clamp(1.75rem,1.1rem+1.9vw,2.75rem)]/[1.05] font-medium tracking-[-0.035em]"
        >
          {title}
        </h2>
        {line ? (
          <p className="max-w-[24rem] text-[15px]/6 text-pretty text-muted-foreground sm:pb-1">
            {line}
          </p>
        ) : null}
      </div>
      <div className="mt-10">{children}</div>
    </section>
  );
}
