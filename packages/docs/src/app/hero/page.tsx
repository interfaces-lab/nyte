import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Asterisk, Code2 } from "lucide-react";
import { gitConfig } from "@/lib/shared";

export const metadata: Metadata = {
  title: "A small core. A world of agents.",
  description:
    "Build cross-platform agentic UI with Nyte. A handwritten agent loop, durable kernel, and tools you can read.",
};

const github = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

function OrbitDiagram() {
  return (
    <svg
      viewBox="0 0 600 600"
      fill="none"
      className="h-full w-full"
      role="img"
      aria-labelledby="orbit-title orbit-description"
    >
      <title id="orbit-title">One core, many orbits</title>
      <desc id="orbit-description">
        A yellow Nyte core surrounded by intersecting elliptical paths connecting tools, models, and
        interfaces.
      </desc>
      <defs>
        <pattern id="hero-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#bab9ac" />
        </pattern>
      </defs>
      <rect x="24" y="24" width="552" height="552" fill="url(#hero-grid)" />
      <circle cx="300" cy="300" r="245" stroke="#cdcec2" strokeDasharray="3 7" />
      <path d="M300 12v576M12 300h576" stroke="#cdcec2" />
      {Array.from({ length: 16 }, (_, index) => (
        <ellipse
          key={index}
          cx="300"
          cy="300"
          rx="230"
          ry={62 + index * 3}
          transform={`rotate(${index * 11.25 + 27} 300 300)`}
          stroke="#242820"
          strokeWidth="0.8"
          opacity="0.7"
        />
      ))}
      <circle cx="300" cy="300" r="65" fill="#deef62" stroke="#242820" />
      <path
        d="m278 319 16-39v39l28-39-15 39"
        stroke="#242820"
        strokeWidth="7"
        strokeLinecap="square"
        strokeLinejoin="bevel"
      />
      <circle cx="167" cy="114" r="8" fill="#242820" stroke="#f4f3eb" strokeWidth="4" />
      <circle cx="514" cy="354" r="8" fill="#deef62" stroke="#242820" strokeWidth="2" />
      <circle cx="155" cy="472" r="6" fill="#242820" />
      <g fill="#f4f3eb" stroke="#c6c7ba">
        <rect x="61" y="70" width="100" height="29" />
        <rect x="459" y="379" width="99" height="29" />
        <rect x="57" y="490" width="115" height="29" />
      </g>
      <g fill="#363b30" fontFamily="monospace" fontSize="10" letterSpacing="1.5">
        <text x="75" y="89">
          INTERFACES
        </text>
        <text x="480" y="398">
          MODELS
        </text>
        <text x="77" y="509">
          YOUR TOOLS
        </text>
      </g>
      <g stroke="#686e5a">
        <path d="M24 36V24h12M564 24h12v12M24 564v12h12M564 576h12v-12" />
      </g>
    </svg>
  );
}

const reading = [
  {
    number: "01",
    title: "Start with the design",
    description: "The kernel, the agent loop, and the boundary between them.",
    href: "/docs/design",
    label: "Architecture",
  },
  {
    number: "02",
    title: "Build on the SDK",
    description: "Create a session, send a message, and subscribe to what happens.",
    href: "/docs/sdk",
    label: "Developer guide",
  },
  {
    number: "03",
    title: "Make it your workspace",
    description: "An Electron host with conversations, files, and a built-in browser.",
    href: "/docs/desktop",
    label: "Desktop",
  },
];

export default function HeroPage() {
  return (
    <div className="min-h-screen bg-[#f4f3eb] font-[family-name:var(--font-geist)] text-[#242820] selection:bg-[#deef62] selection:text-[#242820] [&_a]:outline-offset-8 [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-current">
      <a href="#main" className="sr-only z-50 bg-[#deef62] p-4 focus:not-sr-only focus:absolute">
        Skip to content
      </a>
      <div className="mx-auto max-w-[1440px] px-6 sm:px-10 lg:px-16">
        <header className="flex h-24 items-center justify-between gap-3 border-b border-[#242820]/20">
          <Link
            href="/hero"
            aria-label="Nyte home"
            className="flex items-center gap-2 text-3xl font-semibold tracking-[-0.08em]"
          >
            <Asterisk className="size-8" strokeWidth={2.3} aria-hidden="true" />
            nyte
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-4 text-xs sm:gap-9 sm:text-sm"
          >
            <a
              href="#architecture"
              className="hidden transition-colors hover:text-[#68733b] sm:block"
            >
              The core
            </a>
            <Link href="/docs/design" className="transition-colors hover:text-[#68733b]">
              Documentation
            </Link>
            <a href={github} className="flex items-center gap-2 border-b border-[#242820] pb-1">
              GitHub <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </nav>
        </header>

        <main id="main">
          <section
            className="relative grid gap-6 pt-12 pb-12 lg:grid-cols-[1.05fr_1fr] lg:gap-0 lg:pt-20 lg:pb-16"
            aria-labelledby="hero-heading"
          >
            <div className="relative z-10">
              <p className="flex items-center gap-3 font-mono text-[10px] tracking-[0.16em] uppercase sm:text-xs">
                <span className="size-2 bg-[#6d7c3b]" />
                Independent by design. Handwritten at the core.
              </p>
              <h1
                id="hero-heading"
                className="mt-9 text-[clamp(3.75rem,7.8vw,7.2rem)] leading-[0.98] font-normal tracking-[-0.075em]"
              >
                A small core.
                <br />A world
                <br />
                of{" "}
                <span className="font-[family-name:var(--font-newsreader)] italic tracking-[-0.065em]">
                  agents.
                </span>
              </h1>
              <p className="mt-8 max-w-[390px] text-base leading-relaxed text-[#626658] sm:text-lg">
                Build agentic UI on code you can actually read. A durable kernel, a standalone agent
                loop, and room to make it yours.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-6">
                <Link
                  href="/docs/design"
                  className="group inline-flex items-center gap-9 bg-[#242820] px-6 py-4 text-sm text-[#f4f3eb] transition-colors hover:bg-[#424b32]"
                >
                  Explore Nyte{" "}
                  <ArrowUpRight
                    className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
                </Link>
                <a href={github} className="inline-flex items-center gap-2 text-sm">
                  <Code2 className="size-4" aria-hidden="true" /> Read the source
                </a>
              </div>
              <p className="mt-6 font-mono text-[10px] tracking-wide text-[#686e5a]">
                TypeScript · Terminal + desktop · Yours to extend
              </p>
            </div>
            <div className="relative self-center lg:-mr-7 lg:-ml-8">
              <div className="aspect-square">
                <OrbitDiagram />
              </div>
              <div className="mx-6 flex items-center justify-between border-t border-[#242820]/20 pt-4 font-mono text-[9px] tracking-[0.12em] text-[#626658] uppercase sm:text-[10px]">
                <span>Fig. 01 / The Nyte system</span>
                <span>One core. Many orbits.</span>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-5 border-y border-[#242820]/20 py-6">
            <p className="font-mono text-[10px] tracking-[0.12em] text-[#626658] uppercase">
              Less between you and the machine.
            </p>
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm sm:gap-x-12">
              <span>
                <span className="mr-2 text-[#78834b]">↳</span>Bring your model
              </span>
              <span>
                <span className="mr-2 text-[#78834b]">↳</span>Keep your history
              </span>
              <span>
                <span className="mr-2 text-[#78834b]">↳</span>Build your interface
              </span>
            </div>
            <a
              href="#architecture"
              aria-label="Explore the architecture"
              className="hidden lg:block"
            >
              <ArrowDown className="size-4" />
            </a>
          </div>

          <section
            id="architecture"
            className="scroll-mt-8 py-16 sm:py-24"
            aria-labelledby="architecture-heading"
          >
            <div className="mb-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono text-[10px] tracking-[0.16em] text-[#626658] uppercase">
                  01 / Under the hood
                </p>
                <h2
                  id="architecture-heading"
                  className="mt-4 text-4xl leading-[1.08] tracking-[-0.055em] sm:text-5xl"
                >
                  Understand the whole thing.
                </h2>
              </div>
              <p className="max-w-[310px] text-sm leading-relaxed text-[#626658]">
                Follow a message from the interface to the model. Every step has a place in the
                code.
              </p>
            </div>
            <div className="grid bg-[#252a22] text-[#f4f3eb] lg:grid-cols-[1fr_1.15fr]">
              <div className="flex flex-col justify-between p-7 sm:p-12">
                <div>
                  <span className="inline-block border border-[#deef62]/40 px-2 py-1 font-mono text-[9px] tracking-[0.12em] text-[#deef62] uppercase">
                    Built to be taken apart
                  </span>
                  <h3 className="mt-7 text-3xl leading-tight tracking-[-0.04em] sm:text-4xl">
                    Your interface.
                    <br />
                    Our small, readable core.
                  </h3>
                  <p className="mt-5 max-w-sm text-sm leading-7 text-[#b5baab]">
                    The client talks to the SDK. The kernel records the work. A runner advances it,
                    and the agent loop calls the model and tools. Dependencies point one way.
                  </p>
                </div>
                <Link
                  href="/docs/design#the-turn"
                  className="mt-9 flex w-fit items-center gap-5 border-b border-[#deef62]/50 pb-2 text-sm text-[#deef62]"
                >
                  Follow a turn <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="m-4 grid gap-3 border border-[#f4f3eb]/15 bg-[#1f241d] p-5 sm:m-6 sm:p-8">
                <div className="flex justify-between font-mono text-[9px] tracking-widest text-[#a8af9c] uppercase">
                  <span>System topology</span>
                  <span>↓ Execution flow</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-center font-mono text-xs">
                  <div className="border border-[#f4f3eb]/25 px-3 py-4">Terminal</div>
                  <div className="border border-[#f4f3eb]/25 px-3 py-4">Desktop</div>
                </div>
                <div className="mx-auto h-5 w-px bg-[#8c947b]" />
                <div className="flex items-center justify-between bg-[#deef62] px-5 py-5 text-[#252a22]">
                  <span className="text-lg font-medium tracking-tight">Nyte core</span>
                  <span className="font-mono text-[10px]">SDK → kernel → runner</span>
                </div>
                <div className="mx-auto h-5 w-px bg-[#8c947b]" />
                <div className="flex items-center justify-between border border-[#f4f3eb]/25 px-5 py-4">
                  <span className="font-mono text-xs">Agent loop</span>
                  <span className="font-mono text-[10px] text-[#a8af9c]">model ↔ tools</span>
                </div>
                <p className="mt-3 font-mono text-[9px] leading-5 text-[#a8af9c]">
                  Separate responsibilities. No calls back up the stack.
                </p>
              </div>
            </div>
          </section>

          <section
            className="border-t border-[#242820]/20 pt-8 pb-20"
            aria-labelledby="reading-heading"
          >
            <div className="mb-10 flex items-center justify-between">
              <h2
                id="reading-heading"
                className="font-mono text-[10px] tracking-[0.16em] text-[#626658] uppercase"
              >
                02 / Find your starting point
              </h2>
              <Link href="/docs/design" className="flex items-center gap-2 text-xs">
                All docs <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
            <div className="grid gap-8 md:grid-cols-3 md:gap-0">
              {reading.map((item) => (
                <Link
                  key={item.number}
                  href={item.href}
                  className="group border-b border-[#242820]/20 pb-7 md:border-r md:border-b-0 md:px-8 md:first:pl-0 md:last:border-r-0 md:last:pr-0"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#626658]">
                    <span>
                      {item.number} / {item.label}
                    </span>
                    <ArrowUpRight
                      className="size-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-8 text-2xl tracking-[-0.04em] transition-colors group-hover:text-[#68733b]">
                    {item.title}
                  </h3>
                  <p className="mt-3 max-w-[300px] text-sm leading-relaxed text-[#626658]">
                    {item.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <section
            className="flex flex-col justify-between gap-8 bg-[#deef62] px-7 py-10 sm:flex-row sm:items-center sm:px-12 sm:py-12"
            aria-label="Get started"
          >
            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] uppercase">
                Small enough to understand. Open to possibility.
              </p>
              <h2 className="mt-4 text-4xl tracking-[-0.06em] sm:text-5xl">
                Make something of your own.
              </h2>
            </div>
            <Link
              href="/docs/sdk"
              className="flex shrink-0 items-center justify-between gap-8 border border-[#242820] px-5 py-4 text-sm transition-colors hover:bg-[#242820] hover:text-[#deef62]"
            >
              Start building <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-6 py-9 text-xs text-[#626658]">
          <Link
            href="/hero"
            className="flex items-center gap-2 text-lg font-semibold tracking-[-0.06em] text-[#242820]"
          >
            <Asterisk className="size-5" aria-hidden="true" />
            nyte
          </Link>
          <p>An independent project. Written with intent.</p>
          <div className="flex gap-6">
            <Link href="/docs/design">Docs</Link>
            <a href={github}>GitHub ↗</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
