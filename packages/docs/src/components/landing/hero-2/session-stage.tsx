"use client";

import { IconPhone } from "central-icons";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { DitherMoon } from "../plate/dither-moon";
import { LiveDesktop } from "./live-desktop";
import { LiveMobile } from "./live-mobile";
import { LiveTerminal } from "./live-terminal";
import { LABELS, SCRIPTED_PROMPT, pause, useSession, type Client } from "./use-session";

const CLIENTS = ["terminal", "desktop", "mobile"] as const;
const WIDE = "(min-width: 1280px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

/*
 * Each window's size, as --w and --h, per breakpoint. Below sm every window
 * fills the screen and the dock picks the front one; from sm they overlap.
 */
const SIZES = {
  terminal:
    "[--h:100%] [--w:100%] sm:[--h:86%] sm:[--w:min(80%,760px)] xl:[--h:84%] xl:[--w:min(36%,640px)]",
  desktop: "[--h:100%] [--w:100%] sm:[--w:90%] xl:[--h:94%] xl:[--w:min(56%,1040px)]",
  mobile: "[--h:var(--phone-h)] [--w:calc(var(--phone-h)*390/844)]",
} as const satisfies Record<Client, string>;

/* Where the title bar sits, so it can carry the window. */
const HANDLES = {
  terminal: "h-[38px] rounded-t-[20px]",
  desktop: "h-[41px] rounded-t-[20px]",
  mobile: "h-[calc(var(--phone-h)*54/844)] rounded-t-[calc(var(--phone-h)*54/844)]",
} as const satisfies Record<Client, string>;

const TILES = {
  terminal: (
    <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#2c2c2c,#0a0a0a)] font-mono text-[15px] font-semibold text-[#f5f5f5]">
      &gt;_
    </span>
  ),
  desktop: (
    <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#232a44,#0c1020)] text-[#c1d0f6]">
      <DitherMoon cells={10} pixel={3} />
    </span>
  ),
  mobile: (
    <span className="grid size-full place-items-center rounded-[inherit] bg-[linear-gradient(180deg,#4a5af2,#2222dd)] text-white">
      <IconPhone size={22} />
    </span>
  ),
} as const satisfies Record<Client, ReactNode>;

const tileShadow =
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_0_0_1px_rgb(255_255_255/0.06),0_8px_16px_-8px_rgb(12_16_32/0.5),0_1px_2px_rgb(12_16_32/0.2)]";

const glassClass =
  "h-full rounded-[20px] bg-white/30 p-1.5 shadow-[0_40px_90px_-30px_rgb(6_6_70/0.65)] ring-1 ring-white/40 ring-inset backdrop-blur-md transition-shadow duration-200 focus-within:ring-white/90 dark:bg-white/[0.06] dark:ring-white/10 dark:focus-within:ring-white/35";

/* Fractions of the free space left of and above a window, so it stays on screen at any size. */
interface Placement {
  x: number;
  y: number;
}

interface Drag {
  client: Client;
  startX: number;
  startY: number;
  left: number;
  top: number;
  freeX: number;
  freeY: number;
  placement: Placement;
}

/* Back to front: the desktop app behind, the terminal and the phone over its edges. */
const STACK = ["desktop", "terminal", "mobile"] as const;

const PLACEMENTS = {
  terminal: { x: 0, y: 1 },
  desktop: { x: 0.59, y: 0 },
  mobile: { x: 1, y: 0 },
} as const satisfies Record<Client, Placement>;

function matches(query: string): boolean {
  return window.matchMedia(query).matches;
}

function fraction(offset: number, free: number): number {
  return free > 0 ? Math.min(1, Math.max(0, offset / free)) : 0;
}

function position(placement: Placement) {
  return {
    left: `calc((100% - var(--w)) * ${placement.x})`,
    top: `calc((100% - var(--h)) * ${placement.y})`,
  };
}

/*
 * The three clients as windows on one screen. Drag a window by its title bar,
 * click or tab into it to bring it forward. Each composer is live: a message
 * reaches the other clients in turn and the reply lands in all three.
 */
export function SessionStage({ transcripts }: { transcripts: Record<Client, ReactNode> }) {
  const screen = useRef<HTMLDivElement>(null);
  const floor = useRef<HTMLDivElement>(null);
  const frames = useRef<Partial<Record<Client, HTMLDivElement | null>>>({});
  const rings = useRef<Partial<Record<Client, HTMLSpanElement | null>>>({});
  const drag = useRef<Drag>(null);
  const autoplay = useRef<AbortController>(null);
  const ghost = useRef<Client>(null);
  const orderRef = useRef<readonly Client[]>(STACK);

  const [order, setOrder] = useState<readonly Client[]>(STACK);
  const [placements, setPlacements] = useState<Record<Client, Placement>>(PLACEMENTS);
  const [unseen, setUnseen] = useState<readonly Client[]>([]);
  const [drafts, setDrafts] = useState<Record<Client, string>>({
    terminal: "",
    desktop: "",
    mobile: "",
  });

  const front = order.at(-1);
  const setDraft = (client: Client, text: string) =>
    setDrafts((all) => ({ ...all, [client]: text }));

  const raise = (client: Client) => {
    setUnseen((current) => current.filter((value) => value !== client));
    if (orderRef.current.at(-1) === client) return;
    const next = [...orderRef.current.filter((value) => value !== client), client];
    orderRef.current = next;
    setOrder(next);
  };

  const session = useSession({
    reduced: () => matches(REDUCED),
    arrive: (client) => {
      if (!matches(REDUCED)) {
        rings.current[client]?.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 900,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      }
      if (matches(WIDE) || orderRef.current.at(-1) === client) return;
      setUnseen((current) => (current.includes(client) ? current : [...current, client]));
    },
  });

  const submit = (client: Client) => {
    const text = drafts[client].trim();
    if (!text) return;
    setDraft(client, "");
    session.send(client, text);
  };

  const takeOver = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement)) return;
    const controller = autoplay.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    if (ghost.current) setDraft(ghost.current, "");
    ghost.current = null;
  };

  const startDrag = (client: Client, event: PointerEvent<HTMLDivElement>) => {
    const frame = frames.current[client];
    const area = screen.current;
    if (event.button !== 0 || !frame || !area) return;
    event.preventDefault();
    raise(client);
    const box = area.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    drag.current = {
      client,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left - box.left,
      top: rect.top - box.top,
      freeX: box.width - rect.width,
      freeY: box.height - rect.height,
      placement: placements[client],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /* Moves the window in the DOM; React hears only where it lands. */
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const frame = current ? frames.current[current.client] : undefined;
    if (!current || !frame) return;
    current.placement = {
      x: fraction(current.left + event.clientX - current.startX, current.freeX),
      y: fraction(current.top + event.clientY - current.startY, current.freeY),
    };
    const { left, top } = position(current.placement);
    frame.style.left = left;
    frame.style.top = top;
  };

  const endDrag = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setPlacements((all) => ({ ...all, [current.client]: current.placement }));
  };

  /* Once, when the composers come into view: type the follow-up in one client and send it. */
  const play = useEffectEvent(async (signal: AbortSignal) => {
    const source = matches(WIDE) ? "terminal" : (orderRef.current.at(-1) ?? "mobile");
    await pause(700, signal);
    raise(source);
    if (!matches(REDUCED)) {
      ghost.current = source;
      for (let count = 1; count <= SCRIPTED_PROMPT.length; count += 1) {
        setDraft(source, SCRIPTED_PROMPT.slice(0, count));
        await pause(34, signal);
      }
      await pause(380, signal);
      ghost.current = null;
    }
    setDraft(source, "");
    session.send(source, SCRIPTED_PROMPT);
  });

  useEffect(() => {
    const target = floor.current;
    if (!target) return;
    const controller = new AbortController();
    autoplay.current = controller;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        play(controller.signal).catch(() => undefined);
      },
      { threshold: 1 },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, []);

  const clientProps = (client: Client) => ({
    transcript: transcripts[client],
    turns: session.turns.filter((turn) => turn.seenBy.includes(client)),
    draft: drafts[client],
    busy: session.busy,
    onDraft: (text: string) => setDraft(client, text),
    onSend: () => submit(client),
  });

  return (
    <div
      onFocusCapture={(event) => takeOver(event.target)}
      className="relative mx-auto w-full max-w-[1760px] text-left text-foreground [--area-h:calc(var(--stage-h)_-_88px)] xl:[--area-h:var(--stage-h)] [--phone-h:min(var(--area-h),100cqw*844/390)] [--stage-h:clamp(560px,calc(100svh_-_var(--site-nav-top)_-_var(--site-nav-height)_-_var(--plate-inset)_-_32px),1040px)] [container-type:inline-size] xl:[--phone-h:calc(var(--area-h)*0.92)]"
    >
      <div ref={screen} className="relative isolate h-(--area-h)">
        {CLIENTS.map((client) => (
          <div
            key={client}
            role="group"
            aria-label={LABELS[client]}
            ref={(element) => {
              frames.current[client] = element;
            }}
            onPointerDownCapture={() => raise(client)}
            onFocusCapture={() => raise(client)}
            style={{ zIndex: order.indexOf(client) + 1, ...position(placements[client]) }}
            className={`absolute h-(--h) w-(--w) ${SIZES[client]} ${client === "mobile" ? "rounded-[calc(var(--phone-h)*54/844)] outline-offset-4 outline-white/90 focus-within:outline-2" : ""}`}
          >
            {client === "terminal" ? (
              <div className={glassClass}>
                <LiveTerminal {...clientProps(client)} />
              </div>
            ) : null}
            {client === "desktop" ? (
              <div className={glassClass}>
                <LiveDesktop {...clientProps(client)} />
              </div>
            ) : null}
            {client === "mobile" ? <LiveMobile {...clientProps(client)} /> : null}
            <div
              aria-hidden="true"
              onPointerDown={(event) => startDrag(client, event)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={`absolute inset-x-0 top-0 z-10 cursor-grab touch-none select-none active:cursor-grabbing max-sm:hidden ${HANDLES[client]}`}
            />
            <span
              aria-hidden="true"
              ref={(element) => {
                rings.current[client] = element;
              }}
              className={`pointer-events-none absolute -inset-1 opacity-0 ring-2 ring-white dark:ring-[#c8d0ff] ${client === "mobile" ? "rounded-[calc(var(--phone-h)*58/844)]" : "rounded-[24px]"}`}
            />
          </div>
        ))}
      </div>

      <div ref={floor} className="relative flex h-[88px] items-end justify-center xl:h-0">
        <div
          role="group"
          aria-label="Bring to front"
          className="flex items-end gap-2.5 rounded-[22px] bg-background/70 p-2.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)] ring-1 ring-border-subtle backdrop-blur-xl ring-inset xl:hidden"
        >
          {CLIENTS.map((client) => (
            <button
              key={client}
              type="button"
              aria-label={LABELS[client]}
              aria-pressed={front === client}
              onClick={() => raise(client)}
              className="group relative size-12 cursor-pointer rounded-[25%] bg-transparent p-0 outline-none [corner-shape:squircle] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span
                className={`block size-full rounded-[inherit] transition-[translate,scale] duration-200 ease-nav group-hover:-translate-y-1 group-active:scale-[0.94] motion-reduce:transition-none ${tileShadow}`}
              >
                {TILES[client]}
              </span>
              {unseen.includes(client) ? (
                <span className="absolute -top-1 -right-1 size-3 rounded-full bg-(--hero-blue) ring-2 ring-background" />
              ) : null}
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[12px]/4 font-medium whitespace-nowrap text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                {LABELS[client]}
              </span>
              <span className="absolute -bottom-[7px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground opacity-30 transition-opacity duration-200 group-aria-pressed:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {session.announcement}
      </p>
    </div>
  );
}
