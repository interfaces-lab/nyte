import Link from "next/link";
import { Section, tileClass, tileInvertClass } from "./section";

const PITCH = 12;
const RADIUS = 3.5;

const GLYPHS = {
  terminal: [".......", ".#.....", "..#....", "...#...", "..#....", ".#..###", "......."],
  desktop: ["#######", "#.....#", "#.....#", "#.....#", "#######", "...#...", "..###.."],
  server: ["#######", "#.....#", "#######", ".......", "#######", "#.....#", "#######"],
  mobile: [".#####.", ".#...#.", ".#...#.", ".#...#.", ".#...#.", ".#.#.#.", ".#####."],
} as const;

type Glyph = keyof typeof GLYPHS;

interface Card {
  title: string;
  glyph: Glyph;
  body: string;
  action?: { label: string; href: string };
}

const CARDS: readonly Card[] = [
  {
    title: "Terminal",
    glyph: "terminal",
    body: "The agent in your shell. macOS and Linux.",
    action: { label: "install", href: "#install" },
  },
  {
    title: "Desktop",
    glyph: "desktop",
    body: "The Mac app, for Apple Silicon.",
    action: { label: "download", href: "#install" },
  },
  {
    title: "Your app",
    glyph: "server",
    body: "Put your own client on the core, over JSON and SSE.",
    action: { label: "build on it", href: "/docs/build/composition" },
  },
  { title: "Mobile", glyph: "mobile", body: "A companion for a Mac host." },
];

/*
 * A 7 by 7 dot matrix. Unlit dots stay as a faint grid. On hover the lit dots
 * fold into the centre, nearest first, and make room for the action.
 */
function DotIcon({ glyph }: { glyph: Glyph }) {
  const size = PITCH * 7;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {GLYPHS[glyph].flatMap((row, y) =>
        Array.from(row, (cell, x) => {
          const lit = cell === "#";
          const distance = Math.hypot(x - 3, y - 3);
          return (
            <circle
              key={`${x}-${y}`}
              cx={x * PITCH + PITCH / 2}
              cy={y * PITCH + PITCH / 2}
              r={RADIUS}
              fill="currentColor"
              opacity={lit ? 1 : 0.1}
              style={{ transitionDelay: `${Math.round(distance * 22)}ms` }}
              className="origin-center transition-[scale,opacity] duration-300 ease-nav [transform-box:fill-box] group-hover/card:scale-0 group-hover/card:opacity-0 group-focus-visible/card:scale-0 group-focus-visible/card:opacity-0 motion-reduce:transition-none"
            />
          );
        }),
      )}
    </svg>
  );
}

function CardBody({ card }: { card: Card }) {
  return (
    <>
      <h3 className="flex items-start justify-between gap-3 text-[24px]/[1.15] font-medium tracking-[-0.02em]">
        {card.title}
        {card.action ? null : (
          <span className="mt-2 font-mono text-[12px]/4 font-normal tracking-normal text-muted-foreground">
            soon
          </span>
        )}
      </h3>

      <div className="relative my-8 grid h-32 place-items-center rounded-full bg-background text-foreground transition-colors duration-300 ease-nav group-hover/card:bg-(--hero-blue) group-hover/card:text-white group-focus-visible/card:bg-(--hero-blue) group-focus-visible/card:text-white">
        <DotIcon glyph={card.glyph} />
        {card.action ? (
          <span className="absolute inset-0 grid translate-y-1 place-items-center font-mono text-[13px] opacity-0 transition-[opacity,translate] delay-0 duration-300 ease-nav group-hover/card:translate-y-0 group-hover/card:opacity-100 group-hover/card:delay-150 group-focus-visible/card:translate-y-0 group-focus-visible/card:opacity-100 group-focus-visible/card:delay-150 motion-reduce:transition-none">
            {card.action.label} →
          </span>
        ) : null}
      </div>

      <p className="text-[14px]/5 text-pretty text-muted-foreground transition-colors duration-300 group-hover/card:text-background/70 group-focus-visible/card:text-background/70">
        {card.body}
      </p>
    </>
  );
}

const cardClass = `flex min-h-[17rem] sm:min-h-[22rem] w-full flex-col justify-between p-5 sm:p-6 ${tileClass}`;

export function ProductCards() {
  return (
    <Section id="products-title" title="Where it runs.">
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((card) => (
          <li key={card.title} className="flex">
            {card.action ? (
              <Link
                href={card.action.href}
                className={`group/card ${cardClass} ${tileInvertClass}`}
              >
                <CardBody card={card} />
              </Link>
            ) : (
              <div className={cardClass}>
                <CardBody card={card} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
