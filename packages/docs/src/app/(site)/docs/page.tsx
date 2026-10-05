import type { Metadata } from "next";
import { Geist_Pixel } from "next/font/google";
import Link from "next/link";
import { DitherMoon } from "~/components/landing/plate/dither-moon";
import { FactWord } from "~/components/landing/plate/fact-word";
import { KeyLink } from "~/components/landing/plate/key-link";
import { NavSentinel } from "~/components/landing/plate/nav-sentinel";
import { REVISION } from "~/components/mdx/kernel/source";
import { navGroups } from "~/lib/nav";

export const metadata: Metadata = { title: "Docs" };

const geistPixel = Geist_Pixel({ subsets: ["latin"], display: "swap" });

const buttonClass =
  "inline-flex h-9 items-center gap-2.5 rounded-full pr-2 pl-4 text-[14px] font-medium outline-none transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-(--hero-blue)";

const kbdClass =
  "inline-flex size-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold";

const tileClass =
  "grid size-9 place-items-center rounded-[10px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(12_16_32/0.2)]";

const GROUPS = [
  {
    label: "Start",
    tile: (
      <span className={`${tileClass} bg-[linear-gradient(180deg,#4a5af2,#2222dd)] text-[16px]`}>
        ↓
      </span>
    ),
    blurb: "Install the app or the CLI and run one prompt.",
  },
  {
    label: "Build",
    tile: (
      <span
        className={`${tileClass} bg-[linear-gradient(180deg,#2c2c2c,#0a0a0a)] font-mono text-[13px] font-semibold text-[#f5f5f5]`}
      >
        &gt;_
      </span>
    ),
    blurb: "Compose your own host from the packages.",
  },
  {
    label: "Kernel",
    tile: (
      <span className={`${tileClass} bg-[linear-gradient(180deg,#232a44,#0c1020)] text-[#c1d0f6]`}>
        <DitherMoon cells={8} pixel={3} />
      </span>
    ),
    blurb: "How a message becomes a run.",
  },
  {
    label: "Components",
    tile: (
      <span className={`${tileClass} bg-[linear-gradient(180deg,#c9b8ff,#8f7af2)] text-[15px]`}>
        ▣
      </span>
    ),
    blurb: "Tokens and styled components in @nyte-ai/ui.",
  },
];

export default function DocsHomePage() {
  const groups = navGroups();

  return (
    <>
      <div className="landing-plate relative isolate mx-(--plate-inset) mt-[calc(var(--plate-inset)-var(--site-nav-top)-var(--site-nav-height))] overflow-hidden rounded-(--plate-radius) text-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle">
        <div
          aria-hidden="true"
          className="landing-plate-grain pointer-events-none absolute inset-0"
        />
        <section className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-[calc(var(--plate-nav-drop)+var(--site-nav-height)+56px)] pb-10">
          <h1
            className={`${geistPixel.className} animate-plate-rise text-[clamp(2.25rem,1rem+3vw,3.25rem)] leading-[1.05] tracking-[-0.01em] text-balance motion-reduce:animate-none`}
          >
            Read the kernel.
            <br />
            Build a host.
          </h1>
          <p className="mt-4 max-w-[34rem] animate-plate-rise text-[17px]/7 text-balance text-white/72 [animation-delay:90ms] motion-reduce:animate-none">
            A session is a small{" "}
            <FactWord
              href="/docs/kernel/store"
              above="Content-addressed"
              below="Compare-and-swap refs"
              tint="[--tint:#ffd6e8]"
            >
              git repository
            </FactWord>
            ; a host is anything that calls{" "}
            <FactWord
              href="/docs/build/composition"
              above="Terminal · Desktop"
              below="Serverless"
              tint="[--tint:#c8f3ff]"
            >
              <code className="font-mono text-[15px]">createNyte</code>
            </FactWord>
            .
          </p>
          <div className="mt-6 flex animate-plate-rise flex-wrap gap-2 [animation-delay:180ms] motion-reduce:animate-none">
            <KeyLink
              href="/docs/start/install"
              shortcut="I"
              className={`${buttonClass} bg-white text-(--plate-ink) shadow-[0_1px_2px_rgb(0_0_40/0.2),0_6px_16px_-6px_rgb(0_0_40/0.4)] hover:bg-white/90`}
              kbdClassName={`${kbdClass} bg-(--plate-ink)/10 text-(--plate-ink)/80`}
            >
              Install
            </KeyLink>
            <KeyLink
              href="/docs/build/composition"
              shortcut="B"
              className={`${buttonClass} bg-white/10 text-white ring-1 ring-white/15 ring-inset backdrop-blur-sm hover:bg-white/16`}
              kbdClassName={`${kbdClass} bg-white/16 text-white/90`}
            >
              Build an agent app
            </KeyLink>
          </div>
        </section>
      </div>

      <div className="relative mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-6 pb-24">
        <NavSentinel />
        <nav
          aria-label="Groups"
          className="grid animate-plate-rise gap-3 [animation-delay:260ms] max-md:grid-cols-2 max-sm:grid-cols-1 md:grid-cols-4 motion-reduce:animate-none"
        >
          {groups.map((group) => {
            const first = group.items[0];
            const known = GROUPS.find((candidate) => candidate.label === group.label);
            if (!first || !known) return null;
            return (
              <Link
                key={group.label}
                href={first.href}
                className="flex min-h-44 flex-col gap-2.5 rounded-2xl bg-fill-selected p-5 outline-none transition-colors duration-150 hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {known.tile}
                <span className="mt-1 text-[16px] font-medium">{group.label}</span>
                <span className="flex-1 text-[14px]/5 text-muted-foreground">{known.blurb}</span>
                <span className="font-mono text-[12px] text-tertiary-foreground">
                  {group.items.length} pages
                  {group.label === "Kernel" ? (
                    <>
                      {" · read at "}
                      <a
                        href={`https://github.com/interfaces-lab/nyte/commit/${REVISION}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                      >
                        {REVISION.slice(0, 7)}
                      </a>
                    </>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
