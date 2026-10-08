import { FactWord } from "../plate/fact-word";
import { KeyLink } from "../plate/key-link";
import { NavSentinel } from "../plate/nav-sentinel";
import { AsciiField } from "./ascii-field";

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

/*
 * The plate as a night sky: the moon from the icon, set in ASCII, fills the
 * right of the plate, and one run-in sentence sits low on the left.
 */
export function Hero4() {
  return (
    <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-clip rounded-(--plate-radius) text-white [--plate-haze:#3341ea] [--plate-lift:#2a30e2] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle dark:[--plate-haze:#151a5c] dark:[--plate-lift:#16197a]">
      <div
        aria-hidden="true"
        className="landing-plate-grain pointer-events-none absolute inset-0"
      />

      <section className="relative flex min-h-[max(36rem,min(100svh-2*var(--plate-inset),60rem))] flex-col justify-end">
        <AsciiField className="pointer-events-none absolute inset-0 size-full animate-caption-in font-mono motion-reduce:animate-none" />

        <div className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pb-[clamp(3rem,8vh,5rem)]">
          <div className="max-w-[40rem] animate-plate-rise text-[clamp(1.75rem,1.2rem+1.6vw,2.5rem)]/[1.2] font-medium tracking-[-0.02em] text-pretty motion-reduce:animate-none">
            <h1 className="inline">Agent, deploy anywhere.</h1>{" "}
            <p className="inline text-white/60">
              One kernel, built like{" "}
              <FactWord
                href="/docs/kernel/store"
                above="Content-addressed"
                below="Compare-and-swap refs"
                tint="[--tint:#ffd6e8]"
              >
                git
              </FactWord>
              . Run it{" "}
              <FactWord
                href="/docs"
                above="SQLite"
                below="Terminal + desktop"
                tint="[--tint:#e3dcff]"
              >
                on your laptop
              </FactWord>{" "}
              or{" "}
              <FactWord
                href="/docs/build/composition"
                above="Durable Objects"
                below="Postgres"
                tint="[--tint:#c8f3ff]"
              >
                at the edge
              </FactWord>
              ; every session outlives the process that started it.
            </p>
          </div>

          <div className="mt-9 flex animate-plate-rise flex-wrap gap-2 [animation-delay:180ms] motion-reduce:animate-none">
            <KeyLink
              href="#install"
              shortcut="I"
              className={`${buttonClass} bg-white text-(--plate-ink) shadow-[0_1px_2px_rgb(0_0_40/0.2),0_6px_16px_-6px_rgb(0_0_40/0.4)] hover:bg-white/90`}
              kbdClassName={`${kbdClass} bg-(--plate-ink)/10 text-(--plate-ink)/80`}
            >
              Install Nyte
            </KeyLink>
            <KeyLink
              href="/docs"
              shortcut="D"
              className={`${buttonClass} bg-white/10 text-white ring-1 ring-white/15 ring-inset backdrop-blur-sm hover:bg-white/16`}
              kbdClassName={`${kbdClass} bg-white/16 text-white/90`}
            >
              Read the docs
            </KeyLink>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0">
          <NavSentinel />
        </div>
      </section>
    </div>
  );
}
