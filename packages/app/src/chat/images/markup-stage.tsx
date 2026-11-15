import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { appearance, motion, role, shadow } from "@nyte-ai/ui/styles/vars.stylex";
import {
  CropFrame,
  MIN_CROP,
  cropRect,
  mixRect,
  rectCrop,
  resizeRect,
  roundedRect,
} from "./markup-crop-frame.tsx";
import type { Handle, Rect } from "./markup-crop-frame.tsx";
import { MarkArt, MarkedPhoto, layerOrder } from "./markup-art.tsx";
import type { Tone } from "./markup-art.tsx";
import {
  cameraMatrix,
  clamp,
  coverFactor,
  orientation,
  orientedSize,
  pathLength,
  resample,
  settle,
} from "./markup-geometry.ts";
import type { Camera, Edit, Point, Size } from "./markup-geometry.ts";
import {
  INSTRUMENTS,
  boxFrame,
  fitCircle,
  highlighterColor,
  inkColor,
  settleHighlight,
  mixSpine,
  settledSpine,
  touches,
} from "./markup.ts";
import type { Ink, Mark, Sample, Tool } from "./markup.ts";
import { tween } from "./markup-tween.ts";

const MORPH_POINTS = 64;

const MORPH_MS = 280;

const MIN_STROKE = 3;

const OVERPULL = 0.25;

export interface Fresh {
  readonly id: number;
  readonly from: readonly Point[];
}

const styles = create({
  stage: {
    position: "absolute",
    inset: 0,
    borderRadius: `calc(${radius.surface} - ${space.s1})`,
    userSelect: "none",
  },
  svg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    overflow: "visible",
    touchAction: "none",
    forcedColorAdjust: "none",
  },
  hidden: { cursor: "none" },
  crosshair: { cursor: "crosshair" },
  grab: { cursor: { default: "grab", ":active": "grabbing" } },
  nib: { pointerEvents: "none" },
  size: {
    display: "block",
    width: "max-content",
    translate: "-50% -50%",
    paddingInline: space.s2,
    paddingBlock: space.s0_5,
    borderRadius: radius.pill,
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    "--nyte-hairline-elevation": shadow.shadowLg,
    color: role.contentPrimary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
  },
  sizeShown: { opacity: 1 },
  ring: { fill: "none", stroke: role.contentPrimary, strokeOpacity: 0.85, pointerEvents: "none" },
});

export function Stage(input: {
  readonly src: string;
  readonly image: Size;
  readonly edit: Edit;
  readonly marks: readonly Mark[];
  readonly camera: Camera;
  readonly viewport: Size;
  readonly tool: Tool;
  readonly ink: Ink;
  readonly width: number;
  readonly tone: Tone;
  readonly aspect: number | undefined;
  readonly straightening: boolean;
  readonly panKey: boolean;
  readonly fresh: Fresh | undefined;
  readonly nextId: number;
  readonly draft: Mark | undefined;
  readonly onDraft: (mark: Mark | undefined) => void;
  readonly onViewport: (size: Size) => void;
  readonly onMark: (mark: Mark, fresh: readonly Point[] | undefined) => void;
  readonly onErase: (ids: readonly number[]) => void;
  readonly onCropStart: () => void;
  readonly onCrop: (edit: Edit) => void;
  readonly onCropEnd: (edit: Edit) => void;
  readonly onFreeze: (camera: Camera) => void;
}): ReactElement {
  const id = useId();
  const prefix = id.replace(/[^a-z0-9]/giu, "");
  const [keyboard, setKeyboard] = useState(false);
  const [cursor, setCursor] = useState<Point | undefined>(undefined);
  const keyed = useRef<Sample[] | undefined>(undefined);

  const [erasing, setErasing] = useState<ReadonlySet<number>>(new Set());
  const [hover, setHover] = useState<Point | undefined>(undefined);
  const [cropping, setCropping] = useState(false);
  const [sizing, setSizing] = useState(false);

  const gesture = useRef<
    | { readonly kind: "draw"; readonly pointer: number; points: Sample[] }
    | { readonly kind: "erase"; readonly pointer: number; last: Point; hits: Set<number> }
    | {
        readonly kind: "pan";
        readonly pointer: number;
        readonly start: Point;
        readonly edit: Edit;
        readonly inverse: DOMMatrix;
      }
    | {
        readonly kind: "resize";
        readonly pointer: number;
        readonly handle: Handle;
        readonly start: Point;
        readonly rect: Rect;
        readonly edit: Edit;
        readonly camera: Camera;
      }
    | undefined
  >(undefined);

  const wheelIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const view = cameraMatrix(input.viewport, input.camera);
  const full = view.multiply(orientation(input.image, input.edit));
  const toSource = full.inverse();
  const bounds = orientedSize(input.image, input.edit.turns);
  const rect = cropRect(input.edit.crop, input.camera, input.viewport);
  const unit = toSource.transformPoint({ x: 1, y: 0 });
  const origin = toSource.transformPoint({ x: 0, y: 0 });
  const axis = Math.atan2(unit.y - origin.y, unit.x - origin.x);
  const scale = input.camera.scale;
  const showOutside = cropping || input.straightening;
  const at = cursor ?? { x: input.viewport.width / 2, y: input.viewport.height / 2 };

  const toSample = (point: Point): Sample => {
    const source = toSource.transformPoint(point);

    return { x: source.x, y: source.y, pressure: 0.5 };
  };

  const preview = (points: readonly Sample[], straight: boolean): Mark | undefined =>
    draftMark({ tool: input.tool, points, straight }, input.ink, input.width, scale, axis);

  const [corner, setCorner] = useState(0);

  const [measure] = useState(() => (element: HTMLDivElement | null) => {
    if (element === null) return;

    element.querySelector<SVGSVGElement>("[data-image-markup]")?.focus({ preventScroll: true });

    const observer = new ResizeObserver(() => {
      setCorner(Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0);
      input.onViewport({ width: element.clientWidth, height: element.clientHeight });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      clearTimeout(wheelIdle.current);
    };
  });

  const onWheel = (event: WheelEvent, element: SVGSVGElement) => {
    event.preventDefault();

    if (wheelIdle.current === undefined) input.onCropStart();
    else clearTimeout(wheelIdle.current);

    const next = wheeled(event, element.getBoundingClientRect());

    input.onCrop(next);
    wheelIdle.current = setTimeout(() => {
      wheelIdle.current = undefined;
      input.onCropEnd(next);
    }, 240);
  };

  const wheeled = (event: WheelEvent, box: DOMRect): Edit => {
    const crop = input.edit.crop;
    const inverse = view.inverse();

    if (event.ctrlKey) {
      const w = clamp(crop.w * Math.exp(event.deltaY * 0.01), MIN_CROP / scale, bounds.width * 4);
      const k = w / crop.w;

      const focus = inverse.transformPoint({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });

      return {
        ...input.edit,
        crop: settle(
          {
            cx: focus.x + (crop.cx - focus.x) * k,
            cy: focus.y + (crop.cy - focus.y) * k,
            w,
            h: crop.h * k,
          },
          input.edit.angle,
          bounds,
        ),
      };
    }

    const from = inverse.transformPoint({ x: 0, y: 0 });
    const to = inverse.transformPoint({ x: event.deltaX, y: event.deltaY });

    return {
      ...input.edit,
      crop: settle(
        { ...crop, cx: crop.cx + to.x - from.x, cy: crop.cy + to.y - from.y },
        input.edit.angle,
        bounds,
      ),
    };
  };

  const attachWheel = (element: SVGSVGElement | null) => {
    if (element === null) return;

    const listener = (event: WheelEvent) => onWheel(event, element);

    element.addEventListener("wheel", listener, { passive: false });

    return () => element.removeEventListener("wheel", listener);
  };

  const local = (event: PointerEvent<Element>): Point => {
    const box = event.currentTarget.closest("svg")?.getBoundingClientRect();

    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const sample = (event: globalThis.PointerEvent, box: DOMRect): Sample => {
    const point = toSource.transformPoint({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });

    return { x: point.x, y: point.y, pressure: event.pressure > 0 ? event.pressure : 0.5 };
  };

  const down = (event: PointerEvent<SVGSVGElement>): void => {
    if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setKeyboard(false);

    if (event.button === 1 || input.panKey || input.tool === "move") {
      event.preventDefault();
      input.onCropStart();
      setCropping(true);
      gesture.current = {
        kind: "pan",
        pointer: event.pointerId,
        start: local(event),
        edit: input.edit,
        inverse: view.inverse(),
      };

      return;
    }

    const first = sample(event.nativeEvent, event.currentTarget.getBoundingClientRect());

    if (input.tool === "eraser") {
      gesture.current = { kind: "erase", pointer: event.pointerId, last: first, hits: new Set() };
      erase(first, first);

      return;
    }

    gesture.current = { kind: "draw", pointer: event.pointerId, points: [first] };
    input.onDraft(preview([first], event.shiftKey));
  };

  const erase = (from: Point, to: Point): void => {
    const current = gesture.current;

    if (current?.kind !== "erase") return;

    const reach = input.width / 2 / scale;

    const found = input.marks.filter(
      (mark) => !current.hits.has(mark.id) && touches(mark, from, to, reach),
    );

    if (found.length === 0) return;
    found.forEach((mark) => current.hits.add(mark.id));
    setErasing(new Set(current.hits));
  };

  const grab = (handle: Handle) => (event: PointerEvent<SVGRectElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    event.currentTarget.closest("svg")?.setPointerCapture(event.pointerId);
    input.onCropStart();
    input.onFreeze(input.camera);
    setCropping(true);
    setSizing(true);
    gesture.current = {
      kind: "resize",
      pointer: event.pointerId,
      handle,
      start: local(event),
      rect,
      edit: input.edit,
      camera: input.camera,
    };
  };

  const move = (event: PointerEvent<SVGSVGElement>): void => {
    const current = gesture.current;

    if (current === undefined || current.pointer !== event.pointerId) {
      if (event.pointerType !== "touch") setHover(local(event));

      return;
    }

    if (current.kind === "draw" || current.kind === "erase") {
      const box = event.currentTarget.getBoundingClientRect();
      const coalesced = event.nativeEvent.getCoalescedEvents();

      const added = (coalesced.length === 0 ? [event.nativeEvent] : coalesced).map((each) =>
        sample(each, box),
      );

      setHover(local(event));

      if (current.kind === "erase") {
        added.forEach((point) => {
          erase(current.last, point);
          current.last = point;
        });

        return;
      }

      if (input.draft === undefined) {
        gesture.current = undefined;

        return;
      }

      current.points = [...current.points, ...added];
      input.onDraft(preview(current.points, event.shiftKey));

      return;
    }

    const at = local(event);

    if (current.kind === "pan") {
      const from = current.inverse.transformPoint(current.start);
      const to = current.inverse.transformPoint(at);

      const wanted = {
        ...current.edit.crop,
        cx: current.edit.crop.cx - (to.x - from.x),
        cy: current.edit.crop.cy - (to.y - from.y),
      };

      const held = settle(wanted, current.edit.angle, bounds);

      input.onCrop({
        ...current.edit,
        crop: {
          ...held,
          cx: held.cx + (wanted.cx - held.cx) * OVERPULL,
          cy: held.cy + (wanted.cy - held.cy) * OVERPULL,
        },
      });

      return;
    }

    const wanted = resizeRect(
      current.rect,
      current.handle,
      at.x - current.start.x,
      at.y - current.start.y,
      input.aspect,
    );

    const toCrop = (next: Rect) => rectCrop(next, current.camera, input.viewport);
    const fits = (next: Rect) => coverFactor(toCrop(next), current.edit.angle, bounds) >= 1 - 1e-6;

    const reach = fits(wanted)
      ? 1
      : Array.from({ length: 18 }).reduce<{ low: number; high: number }>(
          (range) => {
            const middle = (range.low + range.high) / 2;

            return fits(mixRect(current.rect, wanted, middle))
              ? { low: middle, high: range.high }
              : { low: range.low, high: middle };
          },
          { low: 0, high: 1 },
        ).low;

    input.onCrop({ ...current.edit, crop: toCrop(mixRect(current.rect, wanted, reach)) });
  };

  const up = (event: PointerEvent<SVGSVGElement>): void => {
    const current = gesture.current;

    if (current === undefined || current.pointer !== event.pointerId) return;
    gesture.current = undefined;

    if (current.kind === "erase") {
      setErasing(new Set());

      if (current.hits.size > 0) input.onErase([...current.hits]);

      return;
    }

    if (current.kind !== "draw") {
      setCropping(false);
      setSizing(false);
      input.onCropEnd(input.edit);

      return;
    }

    commit(current.points, event.shiftKey);
  };

  const commit = (points: readonly Sample[], straight: boolean): void => {
    if (input.draft === undefined) return;
    input.onDraft(undefined);

    const mark = finishMark(input.tool, points, straight);

    if (mark === undefined) return;

    const spine = settledSpine(mark, MORPH_POINTS);

    input.onMark(mark, spine === undefined ? undefined : resample(points, MORPH_POINTS));
  };

  const navigate = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Enter" && input.tool === "eraser") {
      event.preventDefault();
      setKeyboard(true);

      const point = toSample(at);
      const reach = input.width / 2 / scale;
      const hits = input.marks.filter((mark) => touches(mark, point, point, reach));

      if (hits.length > 0) input.onErase(hits.map((mark) => mark.id));

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      setKeyboard(true);

      if (keyed.current === undefined || input.draft === undefined) {
        const first = toSample(at);
        const started = preview([first], false);

        keyed.current = started === undefined ? undefined : [first];
        input.onDraft(started);

        return;
      }

      const points = keyed.current;

      keyed.current = undefined;
      commit(points, false);

      return;
    }

    const step = event.shiftKey ? 20 : 5;

    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];

    if (delta === undefined) return;
    event.preventDefault();
    setKeyboard(true);

    const next = {
      x: clamp(at.x + delta.x, 0, input.viewport.width),
      y: clamp(at.y + delta.y, 0, input.viewport.height),
    };

    setCursor(next);

    if (keyed.current === undefined || input.draft === undefined) return;

    keyed.current = [...keyed.current, toSample(next)];
    input.onDraft(preview(keyed.current, false));
  };

  const cancel = (event: PointerEvent<SVGSVGElement>): void => {
    const current = gesture.current;

    if (current === undefined || current.pointer !== event.pointerId) return;
    gesture.current = undefined;
    setErasing(new Set());

    if (current.kind === "draw") input.onDraft(undefined);

    if (current.kind === "draw" || current.kind === "erase") return;
    setCropping(false);
    setSizing(false);
    input.onCropEnd(input.edit);
  };

  const finishMark = (tool: Tool, points: readonly Sample[], shift: boolean): Mark | undefined => {
    const first = points[0];
    const last = points.at(-1);

    if (first === undefined || last === undefined || tool === "eraser" || tool === "move")
      return undefined;

    const base = { id: input.nextId, ink: input.ink, width: input.width / scale };

    if ((tool === "pen" || tool === "highlight") && pathLength(points) * scale < MIN_STROKE)
      return undefined;

    if (tool === "highlight")
      return {
        ...base,
        kind: tool,
        axis,
        points: settleHighlight(shift ? [first, last] : points, axis, base.width),
      };

    if (tool === "pen") return { ...base, kind: tool, axis, points };

    const span = Math.hypot(last.x - first.x, last.y - first.y);

    if (tool === "circle") {
      if (points.length < 3 && span < base.width * 2) return undefined;

      return { ...base, kind: "circle", ...fitCircle(points, axis, base.width) };
    }

    if (span < base.width * 3) return undefined;

    if (tool === "arrow") return { ...base, kind: "arrow", from: first, to: last };

    return { ...base, kind: "box", frame: boxFrame(first, last, axis, base.width) };
  };

  const ordered = [...input.marks].sort((a, b) => layerOrder(a) - layerOrder(b));
  const drawing = INSTRUMENTS.some((each) => each === input.tool);

  return (
    <div ref={measure} {...props(styles.stage)}>
      <span id={`${id}help`} {...props(srOnly)}>
        Drag to draw with the current tool, or drag a corner to crop. Arrow keys move the drawing
        point; Shift moves farther. Enter starts or finishes a mark. Escape cancels an unfinished
        mark, or closes the viewer.
      </span>
      <svg
        ref={attachWheel}
        data-image-markup=""
        aria-label="Image markup"
        aria-describedby={`${id}help`}
        role="application"
        tabIndex={0}
        {...props(
          focus.ringInset,
          styles.svg,
          input.panKey || input.tool === "move"
            ? styles.grab
            : drawing || input.tool === "eraser"
              ? styles.hidden
              : styles.crosshair,
        )}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onPointerLeave={() => setHover(undefined)}
        onKeyDown={navigate}
        onBlur={() => setKeyboard(false)}
      >
        <defs>
          <clipPath id={`${prefix}canvas`}>
            <rect width={input.viewport.width} height={input.viewport.height} rx={corner} />
          </clipPath>
          <clipPath id={`${prefix}crop`}>
            <path d={roundedRect(rect, showOutside ? 0 : corner)} />
          </clipPath>
        </defs>
        {showOutside && (
          <g opacity={0.3} clipPath={`url(#${prefix}canvas)`}>
            <MarkedPhoto
              src={input.src}
              size={input.image}
              transform={full}
              marks={input.marks}
              tone={input.tone}
              prefix={`${prefix}o`}
            />
          </g>
        )}
        <g clipPath={`url(#${prefix}crop)`}>
          <g transform={full.toString()}>
            <image
              href={input.src}
              width={input.image.width}
              height={input.image.height}
              preserveAspectRatio="none"
            />
            {ordered.map((mark) => (
              <LiveMark
                key={mark.id}
                mark={mark}
                tone={input.tone}
                prefix={prefix}
                erasing={erasing.has(mark.id)}
                from={input.fresh?.id === mark.id ? input.fresh.from : undefined}
              />
            ))}
            {input.draft !== undefined && (
              <MarkArt
                mark={input.draft}
                spine={undefined}
                tone={input.tone}
                prefix={`${prefix}d`}
                erasing={false}
              />
            )}
          </g>
        </g>
        <CropFrame
          rect={rect}
          active={showOutside}
          grid={showOutside}
          aspect={input.aspect}
          onGrab={grab}
        />
        {hover !== undefined && !keyboard && !input.panKey && !showOutside && (
          <Nib at={hover} tool={input.tool} ink={input.ink} width={input.width} />
        )}
        <foreignObject
          x={(rect.left + rect.right) / 2}
          y={(rect.top + rect.bottom) / 2}
          width={1}
          height={1}
          overflow="visible"
          aria-hidden="true"
          pointerEvents="none"
        >
          <span
            {...props(
              text.sm,
              styles.size,
              hairline.ring,
              (sizing || input.straightening) && styles.sizeShown,
            )}
          >
            {Math.round(input.edit.crop.w)} × {Math.round(input.edit.crop.h)}
          </span>
        </foreignObject>
        {keyboard && (
          <g pointerEvents="none">
            <circle cx={at.x} cy={at.y} r={8} strokeWidth={1} {...props(styles.ring)} />
            <path
              d={`M ${at.x - 4} ${at.y} h 8 M ${at.x} ${at.y - 4} v 8`}
              strokeWidth={1}
              {...props(styles.ring)}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function draftMark(
  draft: { readonly tool: Tool; readonly points: readonly Sample[]; readonly straight: boolean },
  ink: Ink,
  width: number,
  scale: number,
  axis: number,
): Mark | undefined {
  const first = draft.points[0];
  const last = draft.points.at(-1);

  if (first === undefined || last === undefined || draft.tool === "eraser" || draft.tool === "move")
    return undefined;

  const base = { id: -1, ink, width: width / scale };

  if (draft.tool === "highlight")
    return {
      ...base,
      kind: "highlight",
      axis,
      points: draft.straight ? [first, last] : draft.points,
    };

  if (draft.tool === "circle") return { ...base, kind: "pen", axis, points: draft.points };

  if (draft.tool === "pen") return { ...base, kind: draft.tool, axis, points: draft.points };

  if (draft.tool === "arrow") return { ...base, kind: "arrow", from: first, to: last };

  return { ...base, kind: "box", frame: boxFrame(first, last, axis, base.width) };
}

function LiveMark(input: {
  readonly mark: Mark;
  readonly tone: Tone;
  readonly prefix: string;
  readonly erasing: boolean;
  readonly from: readonly Point[] | undefined;
}): ReactElement {
  const [progress, setProgress] = useState(input.from === undefined ? 1 : 0);

  useMountEffect(() => {
    if (input.from === undefined) return;

    return tween(MORPH_MS, setProgress);
  });

  const target =
    input.from === undefined || progress >= 1 ? undefined : settledSpine(input.mark, MORPH_POINTS);

  const spine =
    target === undefined || input.from === undefined
      ? undefined
      : mixSpine(input.from, target, progress);

  const mark =
    spine !== undefined && input.mark.kind === "highlight"
      ? { ...input.mark, points: spine.map((point) => ({ ...point, pressure: 0.5 })) }
      : input.mark;

  return (
    <MarkArt
      mark={mark}
      spine={mark.kind === "circle" ? spine : undefined}
      tone={input.tone}
      prefix={input.prefix}
      erasing={input.erasing}
    />
  );
}

function Nib(input: {
  readonly at: Point;
  readonly tool: Tool;
  readonly ink: Ink;
  readonly width: number;
}): ReactElement | null {
  if (input.tool === "eraser")
    return (
      <circle
        cx={input.at.x}
        cy={input.at.y}
        r={input.width / 2}
        strokeWidth={1}
        {...props(styles.ring)}
      />
    );

  if (input.tool === "highlight") {
    const length = input.width;
    const thick = Math.max(4, length * 0.2);

    return (
      <g transform={`rotate(-19.5 ${input.at.x} ${input.at.y})`} {...props(styles.nib)}>
        <rect
          x={input.at.x - thick / 2}
          y={input.at.y - length / 2}
          width={thick}
          height={length}
          rx={1.5}
          fill={highlighterColor(input.ink)}
          fillOpacity={0.8}
        />
        <rect
          x={input.at.x - thick / 2 - 1.5}
          y={input.at.y - length / 2 - 1.5}
          width={thick + 3}
          height={length + 3}
          rx={2.5}
          strokeWidth={1}
          {...props(styles.ring)}
        />
      </g>
    );
  }

  if (input.tool === "pen")
    return (
      <g {...props(styles.nib)}>
        <circle
          cx={input.at.x}
          cy={input.at.y}
          r={Math.max(1.5, input.width / 2)}
          fill={inkColor(input.ink)}
        />
        <circle
          cx={input.at.x}
          cy={input.at.y}
          r={Math.max(1.5, input.width / 2) + 2.5}
          strokeWidth={1}
          {...props(styles.ring)}
        />
      </g>
    );

  return null;
}
