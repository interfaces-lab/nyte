import { Geist_Pixel } from "next/font/google";
import { FactWord } from "../plate/fact-word";
import { KeyLink } from "../plate/key-link";
import { HarnessRing } from "./harness-ring";
import { HARNESSES } from "./harnesses";

const geistPixel = Geist_Pixel({ subsets: ["latin"], display: "swap" });

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

/*
 * The plate opens on the crowd: every harness on a ring, each one a different
 * pattern from the same rules. The promise comes after the visitor has seen
 * how many times the same core got written.
 */
export function Hero3() {
  const count = HARNESSES.length;

  return (
    <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-clip rounded-(--plate-radius) text-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle">
      <div
        aria-hidden="true"
        className="landing-plate-grain pointer-events-none absolute inset-0"
      />

      <section className="relative pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+40px)] pb-16 max-sm:pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+32px)] max-sm:pb-12">
        <p className="animate-plate-rise px-(--site-pad) text-center font-mono text-[12px]/5 text-white/60 motion-reduce:animate-none">
          {count} harnesses, {count} cores written from scratch.
        </p>

        <div className="mt-6 animate-plate-rise [animation-delay:90ms] motion-reduce:animate-none">
          <HarnessRing />
        </div>

        <div className="mx-auto mt-14 flex w-[min(100%,var(--site-inner))] flex-col items-center px-(--site-pad) text-center max-sm:mt-10">
          <h1
            className={`${geistPixel.className} animate-plate-rise text-hero text-balance [animation-delay:180ms] motion-reduce:animate-none`}
          >
            Skip the hard part.
          </h1>

          <p className="mt-6 max-w-[34rem] animate-plate-rise text-[17px]/8 text-balance text-white/72 [animation-delay:260ms] motion-reduce:animate-none">
            Every one of these had to write its own core first. Nyte is that core, built like{" "}
            <FactWord
              href="/docs/kernel/store"
              above="Content-addressed"
              below="Compare-and-swap refs"
              tint="[--tint:#ffd6e8]"
            >
              git
            </FactWord>
            . Its{" "}
            <FactWord href="/docs" above="SQLite" below="Postgres" tint="[--tint:#e3dcff]">
              sessions
            </FactWord>{" "}
            outlive the process, and{" "}
            <FactWord
              href="/docs/build/composition"
              above="Terminal + desktop"
              below="Build an agent app"
              tint="[--tint:#c8f3ff]"
            >
              your client
            </FactWord>{" "}
            goes on top.
          </p>

          <div className="mt-8 flex animate-plate-rise flex-wrap justify-center gap-2 [animation-delay:340ms] motion-reduce:animate-none">
            <KeyLink
              href="/docs/build/composition"
              shortcut="B"
              className={`${buttonClass} bg-white text-(--plate-ink) shadow-[0_1px_2px_rgb(0_0_40/0.2),0_6px_16px_-6px_rgb(0_0_40/0.4)] hover:bg-white/90`}
              kbdClassName={`${kbdClass} bg-(--plate-ink)/10 text-(--plate-ink)/80`}
            >
              Build an agent app
            </KeyLink>
            <KeyLink
              href="#install"
              shortcut="I"
              className={`${buttonClass} bg-white/10 text-white ring-1 ring-white/15 ring-inset backdrop-blur-sm hover:bg-white/16`}
              kbdClassName={`${kbdClass} bg-white/16 text-white/90`}
            >
              Install Nyte
            </KeyLink>
          </div>
        </div>
      </section>
    </div>
  );
}
