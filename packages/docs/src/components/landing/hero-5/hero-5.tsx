import { FactWord } from "../plate/fact-word";
import { KeyLink } from "../plate/key-link";
import { NavSentinel } from "../plate/nav-sentinel";
import { AsciiField } from "../hero-4/ascii-field";

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

export function Hero5() {
  return (
    <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-clip rounded-(--plate-radius) text-white [--plate-haze:#3341ea] [--plate-lift:#2a30e2] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle dark:[--plate-haze:#151a5c] dark:[--plate-lift:#16197a]">
      <div
        aria-hidden="true"
        className="landing-plate-grain pointer-events-none absolute inset-0"
      />

      <section className="relative flex min-h-[max(36rem,min(100svh-2*var(--plate-inset),60rem))] flex-col justify-end">
        <AsciiField className="pointer-events-none absolute inset-0 size-full animate-ascii-in font-mono motion-reduce:animate-none" />

        <div className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pb-[clamp(3rem,8vh,5rem)]">
          <h1 className="animate-plate-rise font-pixel text-hero text-balance motion-reduce:animate-none">
            Nyte is your foundation for building AI frameworks and agents.
          </h1>

          <p className="mt-6 max-w-[27rem] animate-plate-rise text-[17px]/8 text-pretty text-white/72 [animation-delay:90ms] motion-reduce:animate-none">
            Nyte is a{" "}
            <FactWord
              href="/docs/sdk"
              above="TypeScript SDK"
              below="For building AI apps"
              tint="[--tint:#ffd6e8]"
            >
              modern toolkit
            </FactWord>{" "}
            for building AI-driven{" "}
            <FactWord
              href="/docs/build/desktop"
              above="Native-feeling UIs"
              below="Runs on desktop & terminal"
              tint="[--tint:#e3dcff]"
            >
              desktop apps
            </FactWord>{" "}
            with{" "}
            <FactWord
              href="/docs/build/deployment"
              above="Multi-deployment"
              below="From laptops to edge, to cloud"
              tint="[--tint:#c8f3ff]"
            >
              flexible deployment
            </FactWord>{" "}
            and{" "}
            <FactWord
              href="/docs/models"
              above="Multi-model"
              below="Open-source & commercial LLMs"
              tint="[--tint:#ffd6e8]"
            >
              multi-model support
            </FactWord>
            . Build locally, deploy anywhere.
          </p>

          <div className="mt-8 flex animate-plate-rise flex-wrap gap-2 [animation-delay:180ms] motion-reduce:animate-none">
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
