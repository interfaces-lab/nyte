import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Badge,
  BarChart,
  Grid,
  Heading,
  Sparkline,
  Stack,
  Stat,
  Switch,
  Text,
  Toggle,
  ToggleGroup,
  useColorScheme,
} from "nyte/canvas";
import { Details } from "./details.tsx";
import { FILES, GRAPH, HUBS, LAYERS, PACKAGES, ROOT, VALUE_IMPORTS } from "./graph.ts";
import { createLayout } from "./layout.ts";
import { HOME, createGalaxy } from "./scene.ts";
import type { Frame, Galaxy, Orbit, Palette, Rgb } from "./scene.ts";

const STARS = GRAPH.stars.length;

const STAGE_HEIGHT = 440;

const SWATCH = { display: "inline-block", width: 8, height: 8, borderRadius: 4 } as const;

function rgba(rgb: Rgb, alpha: number): string {
  return `rgb(${rgb.map((channel) => Math.round(channel * 255)).join(" ")} / ${alpha.toFixed(3)})`;
}

function percentile(values: readonly number[], share: number): number {
  const sorted = values.toSorted((left, right) => left - right);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

/** Resolves the theme's chart hues and ink from probes the kit itself paints, through a 1px canvas. */
function readPalette(root: HTMLElement, dark: boolean): Palette | null {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  if (probe === null) return null;
  const color = (selector: string): Rgb => {
    const element = root.querySelector(selector);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = element === null ? "gray" : getComputedStyle(element).color;
    probe.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;

    return [red / 255, green / 255, blue / 255];
  };

  return {
    layers: LAYERS.map((_, index) => color(`[data-probe="${index}"] > span`)),
    ink: color('[data-probe="ink"]'),
    dark,
  };
}

const absolute = { position: "absolute", left: 0, top: 0 } as const;

export default function RepoGalaxy() {
  const scheme = useColorScheme();
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [gpu, setGpu] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [renderer, setRenderer] = useState<"three" | "chart">();
  const [layout] = useState(createLayout);
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const hudRef = useRef<HTMLSpanElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRef = useRef<number | null>(null);
  const settingsRef = useRef({ hidden, palette, still });

  useLayoutEffect(() => {
    settingsRef.current = { hidden, palette, still };
  });

  useLayoutEffect(() => {
    const root = probeRef.current;

    if (root === null) return;
    const read = (): void => setPalette(readPalette(root, scheme === "dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, [scheme]);

  useEffect(() => {
    const [canvas, stage, root] = [canvasRef.current, stageRef.current, rootRef.current];

    if (canvas === null || stage === null || root === null) return;
    let drawing: Galaxy | null = null;

    try {
      drawing = gpu ? createGalaxy(canvas) : null;
    } catch {
      drawing = null;
    }

    setRenderer(drawing === null ? "chart" : "three");
    root.dataset["renderer"] = drawing?.detail ?? "Kit chart fallback";

    if (drawing === null) return;
    const camera: Orbit = { ...HOME };
    const pointer = { x: 0, y: 0, inside: false, down: false, dragged: false, lastX: 0, lastY: 0 };
    const emphasis = new Float32Array(STARS).fill(1);
    const size = { width: stage.clientWidth, height: STAGE_HEIGHT, ratio: 1 };
    const intervals: number[] = [];
    const work: number[] = [];
    const clock = { time: 0, frames: 0, last: 0, handle: 0, idle: 0, suppress: 0, pointer: 0 };

    if (settingsRef.current.still) layout.settle();

    const resize = (): void => {
      size.width = stage.clientWidth;
      size.ratio = Math.min(window.devicePixelRatio || 1, 2);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const hover = (next: number | null): void => {
      if (next === focusRef.current) return;
      focusRef.current = next;
      setFocus(next);
    };

    const pick = (frame: Frame): number | null => {
      let best: { readonly id: number; readonly score: number } | null = null;

      for (const star of GRAPH.stars) {
        const point = drawing.project(frame, star.id);

        if ((emphasis[star.id] ?? 0) < 0.5 || point.w <= 0) continue;
        const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
        const reach = Math.max(drawing.screenRadius(frame, star, point.w) + 4, 9);
        const score = distance + point.w * 0.01;

        if (distance < reach && (best === null || score < best.score))
          best = { id: star.id, score };
      }

      return best?.id ?? null;
    };

    const place = (frame: Frame): void => {
      const [current, anchor] = [focusRef.current, anchorRef.current];
      const taken: { readonly x: number; readonly y: number; readonly width: number }[] = [];

      const star = current === null ? undefined : GRAPH.stars[current];

      [star, ...HUBS].forEach((hub, index) => {
        const label = labelRefs.current[index];

        if (label === null || label === undefined) return;
        label.style.opacity = "0";

        if (hub === undefined) return;
        const point = drawing.project(frame, hub.id);
        const [x, y] = [point.x + drawing.screenRadius(frame, hub, point.w) + 6, point.y - 8];
        const width = label.offsetWidth;
        const clear = !taken.some(
          (other) => Math.abs(other.y - y) < 16 && x < other.x + other.width && other.x < x + width,
        );
        const lit = index === 0 || ((emphasis[hub.id] ?? 0) > 0.5 && current !== hub.id);
        const shown = clear && lit && point.w > 0;

        label.style.transform = `translate(${x}px, ${y}px)`;

        if (!shown) return;
        taken.push({ x, y, width });
        label.style.opacity = String(Math.min(1, 1.7 - point.w / 45));
      });

      if (anchor !== null)
        anchor.style.display = star === undefined || star.path === null ? "none" : "block";

      if (star === undefined || anchor === null) return;
      const point = drawing.project(frame, star.id);
      const radius = Math.max(drawing.screenRadius(frame, star, point.w), 6) + 4;
      anchor.style.width = `${radius * 2}px`;
      anchor.style.height = `${radius * 2}px`;
      anchor.style.transform = `translate(${point.x - radius}px, ${point.y - radius}px)`;
    };

    const loop = (now: number): void => {
      clock.handle = requestAnimationFrame(loop);
      const started = performance.now();
      const delta = clock.last === 0 ? 16.7 : now - clock.last;
      const step = Math.min(delta, 50) / 1000;
      clock.last = now;
      const settings = settingsRef.current;

      if (settings.palette === null) return;

      layout.step();
      const current = focusRef.current;

      if (!settings.still) clock.time += step;

      const resting =
        !pointer.down && (current === null || !pointer.inside) && now - clock.idle > 1200;

      if (!settings.still && resting) camera.yaw += step * 0.12;
      const near = new Set(
        current === null
          ? []
          : [
              current,
              ...(GRAPH.stars[current]?.imports.map((edge) => edge.to) ?? []),
              ...(GRAPH.stars[current]?.importers.map((edge) => edge.from) ?? []),
            ],
      );

      const ease = Math.min(1, delta / 90);

      for (const star of GRAPH.stars) {
        const shown = !settings.hidden.includes(LAYERS[star.layer]?.id ?? "");
        const target = shown ? (current === null || near.has(star.id) ? 1 : 0.18) : 0;
        const value = emphasis[star.id] ?? 0;
        emphasis[star.id] = settings.still ? target : value + (target - value) * ease;
      }

      const frame: Frame = {
        ...size,
        orbit: camera,
        time: clock.time,
        palette: settings.palette,
        position: layout.position,
        emphasis,
        focus: current,
      };

      if (pointer.inside && !pointer.down) hover(pick(frame));
      drawing.draw(frame);
      place(frame);
      work.push(performance.now() - started);
      intervals.push(delta);

      intervals.splice(0, intervals.length - 120);
      work.splice(0, work.length - 120);
      clock.frames += 1;

      if (clock.frames % 30 !== 0) return;
      const median = percentile(intervals, 0.5);
      const busy = percentile(work, 0.95);
      root.dataset["frameP50"] = median.toFixed(2);
      root.dataset["frameP95"] = percentile(intervals, 0.95).toFixed(2);
      root.dataset["workP95"] = busy.toFixed(2);

      if (hudRef.current !== null)
        hudRef.current.textContent = `three.js · ${Math.round(1000 / median)} fps · ${busy.toFixed(1)} ms`;
    };
    clock.handle = requestAnimationFrame(loop);

    const orbit = (yaw: number, pitch: number, zoom: number): void => {
      clock.idle = performance.now();
      camera.yaw += yaw;
      camera.pitch = Math.max(-1.3, Math.min(1.3, camera.pitch + pitch));
      camera.distance = Math.max(10, Math.min(70, camera.distance * zoom));
    };

    const locate = (event: PointerEvent): void => {
      const bounds = stage.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
    };

    const release = (): void => {
      if (pointer.dragged) clock.suppress = performance.now() + 80;
      pointer.down = false;

      if (stage.hasPointerCapture(clock.pointer)) stage.releasePointerCapture(clock.pointer);
    };

    const abort = new AbortController();
    const { signal } = abort;
    const listen = <Name extends keyof HTMLElementEventMap>(
      name: Name,
      handler: (event: HTMLElementEventMap[Name]) => void,
    ): void => stage.addEventListener(name, handler, { signal, passive: name !== "wheel" });

    listen("pointerdown", (event) => {
      locate(event);
      pointer.down = true;
      pointer.dragged = false;
      Object.assign(pointer, { lastX: event.clientX, lastY: event.clientY });
      clock.pointer = event.pointerId;
    });
    listen("pointermove", (event) => {
      locate(event);
      pointer.inside = true;
      clock.idle = performance.now();
      const [dx, dy] = [event.clientX - pointer.lastX, event.clientY - pointer.lastY];

      if (!pointer.down || (!pointer.dragged && Math.hypot(dx, dy) < 4)) return;

      if (!pointer.dragged) {
        stage.setPointerCapture(event.pointerId);
        hover(null);
      }

      Object.assign(pointer, { dragged: true, lastX: event.clientX, lastY: event.clientY });
      orbit(-dx * 0.008, dy * 0.008, 1);
    });
    listen("pointerup", release);
    listen("pointercancel", release);
    listen("pointerleave", () => {
      pointer.inside = false;

      if (!pointer.down) hover(null);
    });
    listen("wheel", (event) => {
      event.preventDefault();
      orbit(0, 0, Math.exp(event.deltaY * 0.0012));
    });
    canvas.addEventListener("webglcontextlost", () => setGpu(false), { signal });
    window.addEventListener(
      "click",
      (event) => {
        if (performance.now() > clock.suppress) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { signal, capture: true },
    );

    return () => {
      cancelAnimationFrame(clock.handle);
      observer.disconnect();
      abort.abort();
      drawing.dispose();
    };
  }, [gpu, layout]);

  const star = focus === null ? undefined : GRAPH.stars[focus];
  const opens = star !== undefined && star.path !== null;

  return (
    <div ref={rootRef}>
      <Stack gap={3}>
        <Stack gap={0}>
          <Heading level={3}>How packages/core imports itself</Heading>
          <Text size="sm" tone="secondary">
            {`${FILES.length} modules and ${GRAPH.imports.length} imports, laid out by d3-force and drawn with three.js. Drag to orbit, scroll to zoom, click a star to open its file.`}
          </Text>
        </Stack>
        <div
          ref={stageRef}
          role="img"
          aria-label={`Import graph of packages/core: ${FILES.length} modules, ${GRAPH.imports.length} imports.`}
          style={{
            position: "relative",
            height: STAGE_HEIGHT,
            overflow: "hidden",
            touchAction: "none",
            cursor: focus === null ? "grab" : "pointer",
            display: renderer === "chart" ? "none" : "block",
          }}
        >
          <canvas
            key={gpu ? "gpu" : "cpu"}
            ref={canvasRef}
            style={{ ...absolute, width: "100%", height: STAGE_HEIGHT }}
          />
          {[star, ...HUBS].map((hub, index) => (
            <div
              key={index === 0 ? "focus" : hub?.id}
              ref={(element) => {
                labelRefs.current[index] = element;
              }}
              style={{ ...absolute, pointerEvents: "none", opacity: 0, whiteSpace: "nowrap" }}
            >
              <Text size="xs" tone={index === 0 ? "primary" : "secondary"} mono>
                {hub?.label ?? ""}
              </Text>
            </div>
          ))}
          <a
            ref={anchorRef}
            href={opens ? `${ROOT}${star.path}:1` : "#"}
            aria-label={opens ? `Open ${ROOT}${star.path}` : undefined}
            draggable={false}
            style={{ ...absolute, display: "none", borderRadius: "50%" }}
          />
          <div style={{ position: "absolute", top: 8, right: 8, pointerEvents: "none" }}>
            <Badge tone="info">
              <span ref={hudRef}>three.js</span>
            </Badge>
          </div>
        </div>
        {renderer === "chart" ? (
          <BarChart
            data={HUBS.map((hub) => ({ module: hub.label, importers: hub.importers.length }))}
            keys={["importers"]}
            indexBy="module"
            layout="horizontal"
            height={STAGE_HEIGHT}
          />
        ) : null}
        <Stack direction="row" justify="between" align="center" wrap gap={2}>
          <ToggleGroup
            multiple
            value={LAYERS.flatMap((layer) => (hidden.includes(layer.id) ? [] : [layer.id]))}
            onValueChange={(shown: string[]) =>
              setHidden(LAYERS.flatMap((layer) => (shown.includes(layer.id) ? [] : [layer.id])))
            }
          >
            {LAYERS.map((layer, index) => (
              <Toggle key={layer.id} value={layer.id} size="xs">
                <span
                  aria-hidden="true"
                  style={{
                    ...SWATCH,
                    backgroundColor: rgba(palette?.layers[index] ?? [0.5, 0.5, 0.5], 1),
                  }}
                />
                {layer.id}
              </Toggle>
            ))}
          </ToggleGroup>
          <Switch label="WebGL" checked={gpu} onCheckedChange={setGpu} />
        </Stack>
        <Grid columns={2} gap={4}>
          <Grid columns={2} gap={3}>
            {[
              {
                label: "Modules",
                value: FILES.length,
                detail: `plus ${PACKAGES.length} packages`,
                tone: "neutral" as const,
              },
              {
                label: "Imports",
                value: GRAPH.imports.length,
                detail: `${VALUE_IMPORTS.length} carry values`,
                tone: "neutral" as const,
              },
              {
                label: "Runtime cycles",
                value: GRAPH.runtimeCycles,
                detail: `${GRAPH.typeCycles} modules cycle through types`,
                tone: GRAPH.runtimeCycles > 0 ? ("warning" as const) : ("success" as const),
              },
              {
                label: "Most imported",
                value: HUBS[0]?.importers.length ?? 0,
                detail: HUBS[0]?.label,
                tone: "neutral" as const,
              },
            ].map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </Grid>
          <div style={{ minHeight: 176, minWidth: 0, overflow: "hidden" }}>
            <Details star={star} />
          </div>
        </Grid>
      </Stack>
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{ ...absolute, width: 0, height: 0, overflow: "hidden" }}
      >
        {LAYERS.map((layer, index) => (
          <div key={layer.id} data-probe={index}>
            <Sparkline values={[0, 1]} tint={layer.tint} />
          </div>
        ))}
        <span data-probe="ink" style={{ color: "var(--nyte-content-primary)" }} />
      </div>
    </div>
  );
}
