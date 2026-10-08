"use client";

import { useEffect, useRef } from "react";
import { BAYER } from "../plate/dither-moon";

const RAMP = " .'`:-=+*o%#@";
const TOP = RAMP.length - 1;
const CELL_HEIGHT = 16;
const LANTERN = 120;

/* Dark seas on the near side, in sphere coordinates: x, y, radius, depth. */
const MARIA = [
  [-0.18, -0.28, 0.24, 0.45],
  [0.12, -0.05, 0.2, 0.4],
  [-0.32, 0.18, 0.16, 0.35],
  [0.28, 0.32, 0.14, 0.3],
] as const;

interface Cell {
  x: number;
  y: number;
  level: number;
  alpha: number;
}

function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(from: number, to: number, value: number) {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

/*
 * Dither one cell grid: the moon from the app icon, shaded with the startup
 * moon's ramp, inside a field of dots that fades out behind the copy.
 */
function layout(width: number, height: number, cellWidth: number): Cell[][] {
  const wide = width >= 1180;
  const narrow = width < 640;
  const radius = wide
    ? Math.min(height * 0.32, width * 0.22)
    : Math.min(width * 0.36, height * 0.2);
  const centerX = wide ? width * 0.7 : narrow ? width * 0.5 : width * 0.66;
  const centerY = wide ? height * 0.48 : height * 0.3;
  const cells: Cell[][] = [];

  for (let row = 0; row * CELL_HEIGHT < height; row++) {
    const line: Cell[] = [];
    cells.push(line);
    for (let col = 0; col * cellWidth < width; col++) {
      const x = col * cellWidth;
      const y = row * CELL_HEIGHT;
      const nx = (x + cellWidth / 2 - centerX) / radius;
      const ny = (y + CELL_HEIGHT / 2 - centerY) / radius;
      const depth = 1 - nx * nx - ny * ny;

      if (depth <= 0) {
        const fade = wide
          ? smoothstep(width * 0.2, width * 0.62, x) * (1 - smoothstep(height * 0.82, height, y))
          : 1 - smoothstep(height * 0.4, height * 0.6, y);
        const rim = Math.max(0, 1 - (Math.sqrt(nx * nx + ny * ny) - 1) * 3);
        const alpha = (0.07 + hash(col, row) * 0.09 + rim * 0.12) * fade;
        if (alpha > 0.01) line.push({ x, y, level: 1, alpha });
        continue;
      }

      const sea = MARIA.reduce((dark, [mx, my, mr, md]) => {
        const distance = Math.hypot(nx - mx, ny - my) / mr;
        return distance < 1 ? Math.max(dark, md * (1 - distance * distance)) : dark;
      }, 0);
      const light = (-0.62 * nx - 0.5 * ny + 0.6 * Math.sqrt(depth)) * (1 - sea);
      const dither = (BAYER[(row % 4) * 4 + (col % 4)] - 7.5) / 16;
      const level = Math.round(Math.min(Math.max(light * (TOP - 1) + dither, 0), TOP - 1));

      line.push(
        level < 2
          ? { x, y, level: 2, alpha: 0.26 }
          : { x, y, level, alpha: 0.3 + (level / TOP) * 0.62 },
      );
    }
  }

  return cells;
}

export function AsciiField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    const background = document.createElement("canvas");
    const ink = background.getContext("2d");
    if (!canvas || !host || !context || !ink) return;

    const font = `13px ${getComputedStyle(canvas).fontFamily}`;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cells: Cell[][] = [];
    let pointer: { x: number; y: number } | null = null;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let cellWidth = 0;
    let frame = 0;
    let live = true;

    const draw = () => {
      frame = 0;
      context.globalAlpha = 1;
      context.clearRect(0, 0, width, height);
      context.drawImage(background, 0, 0, width, height);
      if (!pointer || motion.matches) return;
      const bounds = host.getBoundingClientRect();
      const x = pointer.x - bounds.left;
      const y = pointer.y - bounds.top;

      const firstRow = Math.max(0, Math.floor((y - LANTERN) / CELL_HEIGHT));
      const lastRow = Math.min(cells.length, Math.ceil((y + LANTERN) / CELL_HEIGHT));
      for (let row = firstRow; row < lastRow; row++) {
        for (const cell of cells[row]) {
          if (Math.abs(cell.x - x) >= LANTERN) continue;
          const glow = 1 - Math.hypot(cell.x - x, cell.y - y) / LANTERN;
          if (glow <= 0) continue;
          context.clearRect(cell.x, cell.y, cellWidth, CELL_HEIGHT);
          context.globalAlpha = Math.min(cell.alpha + glow * 0.4, 1);
          context.fillText(
            RAMP.charAt(Math.min(cell.level + Math.round(glow * 4), TOP)),
            cell.x,
            cell.y,
          );
        }
      }
    };

    const schedule = () => {
      if (!frame && width > 0 && height > 0) frame = requestAnimationFrame(draw);
    };

    const resize = (force = false) => {
      const bounds = host.getBoundingClientRect();
      const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (!force && width === bounds.width && height === bounds.height && ratio === nextRatio)
        return;
      width = bounds.width;
      height = bounds.height;
      ratio = nextRatio;
      if (width <= 0 || height <= 0) return;
      for (const target of [canvas, background]) {
        target.width = Math.round(width * ratio);
        target.height = Math.round(height * ratio);
      }
      for (const target of [context, ink]) {
        target.setTransform(ratio, 0, 0, ratio, 0, 0);
        target.font = font;
        target.textBaseline = "top";
        target.fillStyle = "#fff";
      }
      cellWidth = ink.measureText("0").width;
      cells = layout(width, height, cellWidth);
      for (const row of cells) {
        for (const cell of row) {
          ink.globalAlpha = cell.alpha;
          ink.fillText(RAMP.charAt(cell.level), cell.x, cell.y);
        }
      }
      schedule();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || motion.matches) return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };

    const onLeave = () => {
      if (!pointer) return;
      pointer = null;
      schedule();
    };

    const observer = new ResizeObserver(() => resize());
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    motion.addEventListener("change", onLeave);
    void document.fonts
      .load(font)
      .catch(() => [])
      .then(() => {
        if (!live) return;
        observer.observe(host);
        resize(true);
      });

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      motion.removeEventListener("change", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
