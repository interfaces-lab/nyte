import { role } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { Geist_Pixel } from "next/font/google";
import { FactWord } from "./fact-word";
import { HostStage } from "./host-stage";
import { DesktopHost } from "./hosts/desktop-host";
import { MobileHost } from "./hosts/mobile-host";
import { TerminalHost } from "./hosts/terminal-host";
import { KeyLink } from "./key-link";
import { NavSentinel } from "./nav-sentinel";

const geistPixel = Geist_Pixel({ subsets: ["latin"], display: "swap" });

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

export function PlateHero() {
  return (
    <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-hidden rounded-(--plate-radius) text-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle">
      <div
        aria-hidden="true"
        className="landing-plate-grain pointer-events-none absolute inset-0"
      />

      <section className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+64px)] pb-(--site-pad) max-sm:pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+52px)]">
        <div className="flex flex-col items-center text-center">
          <h1
            className={`${geistPixel.className} animate-plate-rise text-[clamp(2.75rem,1.1rem+4.6vw,4.75rem)] leading-[1.02] tracking-[-0.01em] text-balance motion-reduce:animate-none`}
          >
            Agent, deploy <br />
            anywhere.
          </h1>

          <p className="mt-6 max-w-[34rem] animate-plate-rise text-[17px]/8 text-balance text-white/72 [animation-delay:90ms] motion-reduce:animate-none">
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
              href="/docs/build/desktop"
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

          <div className="mt-8 flex animate-plate-rise flex-wrap justify-center gap-2 [animation-delay:180ms] motion-reduce:animate-none">
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

          <div className="relative mt-12 w-full max-sm:mt-10">
            <NavSentinel />
            <div
              aria-hidden="true"
              {...props(styles.fade)}
              className="landing-plate-fade pointer-events-none absolute inset-x-[-50vw] top-[18%] -bottom-(--site-pad)"
            />
            <div className="relative animate-plate-rise [--rise:40px] [animation-delay:260ms] motion-reduce:animate-none">
              <HostStage
                hosts={{
                  terminal: <TerminalHost />,
                  desktop: <DesktopHost />,
                  mobile: <MobileHost />,
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles = create({
  fade: {
    backgroundImage: `linear-gradient(to bottom, transparent, color-mix(in oklab, var(--plate-haze) 70%, transparent) 22%, ${role.bgBase} 56%)`,
  },
});
