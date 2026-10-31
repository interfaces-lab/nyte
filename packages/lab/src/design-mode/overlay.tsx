import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { Box, Outline } from "./picker";

/** The accent as RGB components for the canvas; `design.accent` in design.stylex.ts is the same colour. */
const ACCENT_RGB = "56 132 255";

/**
 * react-grab's layers: one alpha pair per role, 1px strokes, and a fill faint enough to read
 * through. X-ray has no fill, so nested elements don't darken the page where they stack.
 */
const LAYERS = {
  xray: { stroke: 0.3, fill: 0 },
  covered: { stroke: 0.5, fill: 0.08 },
  marquee: { stroke: 0.4, fill: 0.05 },
  hover: { stroke: 0.5, fill: 0.08 },
  selected: { stroke: 0.9, fill: 0.08 },
} as const;

/** react-grab's glide: each 60 Hz frame closes 95% of the gap, scaled to the real frame time. */
const GLIDE = 0.95;

const FRAME_MS = 1000 / 60;

const SETTLED_PX = 0.5;

export interface Scene {
  readonly xray: readonly Outline[];
  readonly covered: readonly Outline[];
  readonly marquee: Box | undefined;
  readonly hover: Outline | undefined;
  readonly selected: readonly Outline[];
  readonly region: Box | undefined;
}

interface Glide {
  readonly current: Outline;
  readonly target: Outline;
}

/** Paints the scene on one canvas, the way react-grab does, so X-ray's hundreds of boxes cost one layer. */
export function OverlayCanvas({
  width,
  height,
  zoom,
  scene,
}: {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly scene: Scene;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glide = useRef<Glide | undefined>(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- repaints the canvas and runs the hover glide after every render
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === null || context === undefined) return;
    const ratio = window.devicePixelRatio * zoom;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const target = scene.hover;

    glide.current =
      target === undefined
        ? undefined
        : { current: glide.current?.current ?? target, target: target };
    let frame = 0;
    let last = performance.now();

    const draw = (now: number): void => {
      const step = 1 - (1 - GLIDE) ** (Math.max(now - last, 1) / FRAME_MS);
      const moving = glide.current;

      last = now;

      if (moving !== undefined) {
        const next = glideOutline(moving.current, moving.target, step);

        glide.current = {
          current:
            Math.abs(next.x - moving.target.x) < SETTLED_PX &&
            Math.abs(next.y - moving.target.y) < SETTLED_PX &&
            Math.abs(next.width - moving.target.width) < SETTLED_PX &&
            Math.abs(next.height - moving.target.height) < SETTLED_PX
              ? moving.target
              : next,
          target: moving.target,
        };
      }

      paint(context, ratio, width, height, scene, glide.current?.current);

      if (glide.current !== undefined && glide.current.current !== glide.current.target) {
        frame = requestAnimationFrame(draw);
      }
    };

    frame = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frame);
  });

  return <canvas ref={canvasRef} aria-hidden="true" {...props(styles.canvas)} />;
}

function paint(
  context: CanvasRenderingContext2D,
  ratio: number,
  width: number,
  height: number,
  scene: Scene,
  hover: Outline | undefined,
): void {
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (scene.region !== undefined) {
    context.fillStyle = "rgb(15 23 32 / 0.1)";
    context.fillRect(0, 0, width, height);
    context.clearRect(scene.region.x, scene.region.y, scene.region.width, scene.region.height);
  }

  for (const outline of scene.xray) roundedBox(context, outline, LAYERS.xray);

  for (const outline of scene.covered) roundedBox(context, outline, LAYERS.covered);

  if (scene.marquee !== undefined) {
    roundedBox(context, { ...scene.marquee, radius: 0 }, LAYERS.marquee);
  }

  for (const outline of scene.selected) roundedBox(context, outline, LAYERS.selected);

  if (scene.region !== undefined) {
    roundedBox(context, { ...scene.region, radius: 0 }, LAYERS.selected);
  }

  if (hover !== undefined) roundedBox(context, hover, LAYERS.hover);
}

function roundedBox(
  context: CanvasRenderingContext2D,
  outline: Outline,
  layer: { readonly stroke: number; readonly fill: number },
): void {
  if (outline.width <= 0 || outline.height <= 0) return;
  const radius = Math.min(outline.radius, outline.width / 2, outline.height / 2);

  context.beginPath();
  context.roundRect(
    outline.x + 0.5,
    outline.y + 0.5,
    outline.width - 1,
    outline.height - 1,
    radius,
  );

  if (layer.fill > 0) {
    context.fillStyle = `rgb(${ACCENT_RGB} / ${String(layer.fill)})`;
    context.fill();
  }

  context.strokeStyle = `rgb(${ACCENT_RGB} / ${String(layer.stroke)})`;
  context.lineWidth = 1;
  context.stroke();
}

function glideOutline(from: Outline, to: Outline, step: number): Outline {
  return {
    x: from.x + (to.x - from.x) * step,
    y: from.y + (to.y - from.y) * step,
    width: from.width + (to.width - from.width) * step,
    height: from.height + (to.height - from.height) * step,
    radius: to.radius,
  };
}

const styles = create({
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  },
});
