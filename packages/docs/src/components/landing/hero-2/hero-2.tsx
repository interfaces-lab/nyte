import { Geist_Pixel } from "next/font/google";
import { FactWord } from "../plate/fact-word";
import { DesktopTranscript } from "../plate/hosts/desktop-host";
import { ChatTranscript } from "../plate/hosts/mobile-host";
import { TerminalTranscript } from "../plate/hosts/terminal-host";
import { KeyLink } from "../plate/key-link";
import { NavSentinel } from "../plate/nav-sentinel";
import { SessionStage } from "./session-stage";

const geistPixel = Geist_Pixel({ subsets: ["latin"], display: "swap" });

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

/*
 * The plate with the copy pulled into one band, so the three clients can take
 * the full height below it. The clients are live and share one session.
 */
export function Hero2() {
  return (
    <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-clip rounded-(--plate-radius) text-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle">
      <div
        aria-hidden="true"
        className="landing-plate-grain pointer-events-none absolute inset-0"
      />

      <section className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+64px)] pb-12 max-sm:pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+52px)] max-sm:pb-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <h1
            className={`${geistPixel.className} shrink-0 animate-plate-rise text-hero motion-reduce:animate-none`}
          >
            Agent, deploy <br />
            anywhere.
          </h1>

          <div className="min-w-0 lg:max-w-[25rem] lg:pb-1.5">
            <p className="animate-plate-rise text-[16px]/7 text-pretty text-white/72 [animation-delay:90ms] motion-reduce:animate-none">
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

            <div className="mt-6 flex animate-plate-rise flex-wrap gap-2 [animation-delay:180ms] motion-reduce:animate-none">
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
        </div>
      </section>

      <div className="relative animate-plate-rise px-3 pb-3 [--rise:40px] [animation-delay:260ms] motion-reduce:animate-none sm:px-4 xl:px-6 xl:pb-4">
        <NavSentinel />
        <SessionStage
          transcripts={{
            terminal: <TerminalTranscript />,
            desktop: <DesktopTranscript />,
            mobile: <ChatTranscript />,
          }}
        />
      </div>
    </div>
  );
}
