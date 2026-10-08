"use client";

import Link from "next/link";
import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { githubUrl } from "~/lib/shared";
import { AsciiArt } from "./ascii-art";
import { ASCII_LOGOS } from "./ascii-logos";
import { AsciiMoon } from "./ascii-moon";
import { HARNESSES, harnessMeta } from "../hero-3/harnesses";
import { BlockPrint } from "./block-print";
import { Section, brandTileClass, tileClass } from "./section";

const NYTE = { name: "Nyte", meta: "mine, and yours · MIT" };

/* The row where Nyte's 2x2 tile starts, so it closes the grid at the bottom right. */
function lastRows(columns: number) {
  return Math.ceil((HARNESSES.length + 4) / columns) - 1;
}

/*
 * Every harness's core as a tile, each a different pattern from the same
 * rules. Nyte closes the grid. Hovering or focusing one names it below.
 */
export function CoreMosaic() {
  const grid = useRef<HTMLUListElement>(null);
  const pointerType = useRef("");
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const active = hovered ?? focused;
  const [focusable, setFocusable] = useState(0);

  const count = HARNESSES.length + 1;
  const named = active === null ? null : active < HARNESSES.length ? HARNESSES[active] : undefined;
  const caption =
    active === null
      ? { name: "", meta: "" }
      : named
        ? { name: named.name, meta: harnessMeta(named) }
        : NYTE;

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = grid.current;
    if (!list) return;
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -count,
      End: count,
    }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(focusable + step, 0), count - 1);
    setHovered(null);
    setFocused(next);
    list.querySelectorAll<HTMLElement>("[data-tile]")[next]?.focus();
  };

  const slot = (index: number) => ({
    onPointerEnter: (event: PointerEvent<HTMLLIElement>) => {
      if (event.pointerType !== "touch") setHovered(index);
    },
    onPointerLeave: () => setHovered(null),
  });

  const stop = (index: number) => ({
    "data-tile": "",
    tabIndex: focusable === index ? 0 : -1,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      setFocusable(index);
      if (!event.currentTarget.matches(":focus-visible")) return;
      setHovered(null);
      setFocused(index);
    },
    onBlur: () => setFocused(null),
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pointerType.current = event.pointerType;
      if (event.pointerType !== "touch") setFocused(null);
    },
  });

  const gridStyle = {
    gridAutoFlow: "dense",
    "--r3": lastRows(3),
    "--r6": lastRows(6),
  };

  return (
    <Section
      id="cores-title"
      title="Countless cores."
      line="Each one fits the harness it was written for."
    >
      <ul
        ref={grid}
        aria-label="Agent harnesses"
        onKeyDown={move}
        style={gridStyle}
        className="grid grid-cols-3 gap-1 sm:grid-cols-6"
      >
        {HARNESSES.map((harness, index) => (
          <li key={harness.name} {...slot(index)} className="aspect-square">
            <button
              type="button"
              onClick={(event) => {
                if (event.detail === 0) {
                  setFocused(index);
                } else if (pointerType.current === "touch") {
                  event.currentTarget.focus();
                  setFocused((current) => (current === index ? null : index));
                }
              }}
              data-active={active === index}
              aria-label={`${harness.name}, ${harnessMeta(harness)}`}
              {...stop(index)}
              className={`group/tile relative grid size-full cursor-default place-items-center text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-foreground data-[active=true]:text-background ${tileClass}`}
            >
              <BlockPrint
                index={index}
                className="w-[86%] transition-opacity duration-200 group-data-[active=true]/tile:opacity-0 motion-reduce:transition-none"
              />
              <AsciiArt
                rows={ASCII_LOGOS[harness.logo]}
                className="absolute w-[76%] opacity-0 transition-opacity duration-200 group-data-[active=true]/tile:opacity-100 motion-reduce:transition-none"
              />
            </button>
          </li>
        ))}
        <li
          {...slot(HARNESSES.length)}
          className="col-[-3/-1] row-[var(--r3)/span_2] sm:row-[var(--r6)/span_2]"
        >
          <Link
            href={githubUrl}
            aria-label="Nyte on GitHub, MIT license"
            {...stop(HARNESSES.length)}
            className={`group/nyte relative flex size-full flex-col justify-between overflow-clip p-3 ${brandTileClass}`}
          >
            <AsciiMoon className="w-[44%] self-end transition-transform duration-500 ease-nav group-hover/nyte:-translate-y-1 motion-reduce:transition-none" />
            <span>
              <span className="block text-[15px]/5 font-medium">Nyte</span>
              <span className="block font-mono text-[11px]/4 text-white/70">MIT · GitHub</span>
            </span>
          </Link>
        </li>
      </ul>

      <p
        aria-hidden="true"
        className="mt-3 flex h-5 items-baseline justify-between gap-6 text-[13px]/5"
      >
        <span
          key={caption.name}
          className="flex min-w-0 animate-ascii-in items-baseline gap-3 motion-reduce:animate-none"
        >
          <span className="font-medium whitespace-nowrap">{caption.name}</span>
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            {caption.meta}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
          {active === null ? "" : `${String(active + 1).padStart(2, "0")} / ${count}`}
        </span>
      </p>
    </Section>
  );
}
