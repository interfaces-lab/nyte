"use client";

import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useEffect, useRef, type PointerEvent } from "react";
import {
  MOON_COLS,
  MOON_ROWS,
  bakeSurface,
  renderMoon,
  viewAt,
  type Surface,
} from "./moon-surface";
import { paperMono } from "./paper-mono";

/* Stage geometry. The moon spans 38% of the stage width. */
const W = 1200;
const H = 660;
const MOON_SHARE = 0.38;

export function MoonStage({ initialFrame }: { initialFrame: string }) {
  const still = useReducedMotion() ?? false;
  const moonRef = useRef<HTMLPreElement>(null);
  /* Offscreen, the moon keeps its last frame and costs nothing. */
  const visible = useInView(moonRef);
  const surfaceRef = useRef<Surface | null>(null);
  const lastFrameRef = useRef(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  /* Drag turns the moon by hand; let go and it springs back onto its steady spin. */
  const pullLon = useMotionValue(0);
  const pullLat = useMotionValue(0);
  const lon = useSpring(pullLon, { stiffness: 70, damping: 12, mass: 0.8 });
  const lat = useSpring(pullLat, { stiffness: 70, damping: 12, mass: 0.8 });

  useEffect(() => {
    /* Bake after first paint so the server frame shows while the texture builds. */
    const id = setTimeout(() => {
      surfaceRef.current = bakeSurface();
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useAnimationFrame((ms) => {
    const surface = surfaceRef.current;
    const pre = moonRef.current;
    const pulled = Math.abs(lon.get()) > 0.05 || Math.abs(lat.get()) > 0.05;
    if (!surface || !pre || !visible || (still && !pulled) || ms - lastFrameRef.current < 1000 / 24)
      return;
    lastFrameRef.current = ms;
    const view = viewAt(still ? 0 : ms / 1000);
    pre.textContent = renderMoon(surface, MOON_COLS, MOON_ROWS, {
      sunLon: view.sunLon,
      lonTilt: view.lonTilt + lon.get(),
      latTilt: view.latTilt + lat.get(),
    });
  });

  const grab = (event: PointerEvent<HTMLPreElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX + pullLon.get() * 4,
      y: event.clientY + pullLat.get() * 4,
    };
  };
  const pull = (event: PointerEvent<HTMLPreElement>) => {
    const start = dragRef.current;
    if (!start) return;
    /* Dragging right carries the near side right, against the spin. */
    pullLon.set(Math.max(-60, Math.min(60, -(event.clientX - start.x) / 4)));
    pullLat.set(Math.max(-30, Math.min(30, -(event.clientY - start.y) / 4)));
  };
  const release = () => {
    dragRef.current = null;
    pullLon.set(0);
    pullLat.set(0);
  };

  return (
    <div
      className="relative w-full [container-type:inline-size]"
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: `${MOON_SHARE * 135}%`,
          background:
            "radial-gradient(closest-side, var(--hero-glow), color-mix(in srgb, var(--hero-glow) 30%, transparent) 55%, transparent)",
        }}
      />

      {/* The disc hides the stars behind it, dark side included. */}
      <div
        className="absolute top-1/2 left-1/2 z-[2] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--hero-moon)"
        style={{ width: `${MOON_SHARE * 100}%` }}
      />
      <motion.pre
        ref={moonRef}
        aria-hidden="true"
        onPointerDown={grab}
        onPointerMove={pull}
        onPointerUp={release}
        onPointerCancel={release}
        className={`${paperMono.className} absolute top-1/2 left-1/2 z-[2] m-0 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none leading-none tracking-normal whitespace-pre text-white select-none active:cursor-grabbing`}
        style={{
          fontSize: `calc(${MOON_SHARE * 100}cqw / ${MOON_COLS * 0.6})`,
          /* Frames trim trailing spaces, so pin the box or it shifts as the limb darkens. */
          width: `${MOON_COLS * 0.6}em`,
          height: `${MOON_ROWS}em`,
        }}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {initialFrame}
      </motion.pre>
    </div>
  );
}
