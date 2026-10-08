import Link from "next/link";
import { DitherMoon } from "../plate/dither-moon";
import { Fingerprint } from "./fingerprint";
import { HARNESSES, harnessMeta } from "./harnesses";

const tileClass =
  "flex h-full flex-col overflow-clip rounded-[16px] bg-(--site-panel) p-2 ring-1 ring-border-subtle";

/* Every card from the ring, laid flat, with Nyte last. */
export function HarnessArchive() {
  return (
    <section
      aria-labelledby="archive-title"
      className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-12">
        <h2
          id="archive-title"
          className="font-display text-[32px]/[1.1] font-medium tracking-[-0.03em]"
        >
          The hard part, {HARNESSES.length} times.
        </h2>
        <p className="max-w-[26rem] text-[15px]/6 text-pretty text-muted-foreground">
          Sessions, the agent loop, tools, and storage are the core. Yours starts at the client.
        </p>
      </div>

      <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {HARNESSES.map((harness) => (
          <li key={harness.name} className={tileClass}>
            <div className="rounded-[10px] bg-background p-2 text-(--hero-blue) dark:text-white/70">
              <Fingerprint
                seed={harness.name}
                cols={48}
                rows={36}
                pixel={3}
                className="block h-auto w-full"
              />
            </div>
            <div className="px-2 pt-3 pb-2">
              <p className="text-[14px]/5 font-medium">{harness.name}</p>
              <p className="mt-0.5 font-mono text-[12px]/5 text-muted-foreground">
                {harnessMeta(harness)}
              </p>
            </div>
          </li>
        ))}
        <li>
          <Link
            href="/docs"
            className={`${tileClass} bg-(--hero-blue) text-white outline-none transition-[background-color] duration-150 hover:bg-(--hero-blue)/88 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >
            <div className="grid aspect-[4/3] w-full place-items-center rounded-[10px] bg-white/10">
              <DitherMoon cells={16} pixel={4} />
            </div>
            <div className="px-2 pt-3 pb-2">
              <p className="text-[14px]/5 font-medium">Nyte</p>
              <p className="mt-0.5 font-mono text-[12px]/5 text-white/70">the core · MIT</p>
            </div>
          </Link>
        </li>
      </ul>
    </section>
  );
}
