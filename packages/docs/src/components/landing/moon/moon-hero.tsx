import Link from "next/link";
import { FrostedWord } from "./frosted-word";
import { MoonStage } from "./moon-stage";
import { MOON_COLS, MOON_ROWS, bakeSurface, renderMoon, viewAt } from "./moon-surface";
import { Sky } from "./sky";
import { UserPointer } from "./user-pointer";

/* Rendered once at build, so the moon is there before any script runs. */
const initialFrame = renderMoon(bakeSurface(), MOON_COLS, MOON_ROWS, viewAt(0));

export function MoonHero() {
  return (
    <div className="hero-plate relative overflow-hidden bg-(--hero-sky) text-white">
      <Sky />
      <UserPointer />
      <section className="relative z-[2] mx-auto flex min-h-svh pt-(--site-nav-height) w-[min(100%,var(--site-inner))] flex-col items-center justify-center gap-6 px-[var(--site-pad)] pb-12">
        <div className="w-[min(100vw,1200px,calc((100svh-var(--site-nav-height)-230px)*1200/660))]">
          <MoonStage initialFrame={initialFrame} />
        </div>

        <h1 className="font-display text-center text-[clamp(2.5rem,6vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.05em]">
          Agent, deploy <FrostedWord>anywhere.</FrostedWord>
        </h1>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/docs/sdk"
            className="inline-flex h-11 items-center rounded-full bg-white px-5 text-[15px] font-medium text-[var(--hero-blue)] transition-colors hover:bg-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-sky)"
          >
            createNyte
          </Link>
          <Link
            href="/docs/design"
            className="inline-flex h-11 items-center rounded-full px-5 text-[15px] text-white/72 transition-colors hover:bg-white/12 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-sky)"
          >
            Read the design
          </Link>
        </div>
      </section>
    </div>
  );
}
