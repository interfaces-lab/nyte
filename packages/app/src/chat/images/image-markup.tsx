import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { media } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { markDot, markPath, markWidth, markupInk, markupLight, markupOpacity } from "./markup.ts";
import type { Ink, Mark, Point } from "./markup.ts";

const styles = create({
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    overflow: "visible",
    pointerEvents: "none",
  },
  drawing: { pointerEvents: "auto", touchAction: "none", cursor: "crosshair" },
  ink: { mixBlendMode: "multiply" },
  art: { forcedColorAdjust: "none" },
  cursor: { color: { default: role.contentPrimary, [media.forcedColors]: "CanvasText" } },
});

export function ImageMarkup(input: {
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
  readonly enabled: boolean;
  readonly tool: Mark["kind"];
  readonly ink: Ink;
  readonly marks: readonly Mark[];
  readonly draft: Mark | undefined;
  readonly onDraft: (mark: Mark | undefined) => void;
  readonly onMark: (mark: Mark) => void;
}): ReactElement {
  const help = useId();
  const pointer = useRef<number | undefined>(undefined);
  const [keyboard, setKeyboard] = useState(false);

  const [point, setPoint] = useState<Point>({
    x: input.width / 2,
    y: input.height / 2,
    pressure: 0.5,
  });

  const commit = (mark: Mark): void => {
    input.onDraft(undefined);

    if (mark.kind !== "pen") {
      const width = Math.abs(mark.to.x - mark.from.x);
      const height = Math.abs(mark.to.y - mark.from.y);

      if (mark.kind === "arrow" ? width + height === 0 : width === 0 || height === 0) return;
    }

    input.onMark(mark);
  };

  const start = (event: PointerEvent<SVGSVGElement>): void => {
    if (!input.enabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    setKeyboard(false);
    const point = pointerPoint(event.nativeEvent, event.currentTarget, input.width, input.height);
    input.onDraft(
      !keyboard && input.draft !== undefined && input.draft.kind !== "pen"
        ? extendMark(input.draft, [point])
        : startMark(input.tool, input.ink, point),
    );
  };

  const move = (event: PointerEvent<SVGSVGElement>): void => {
    if (!input.enabled || pointer.current !== event.pointerId || input.draft === undefined) return;
    const samples = event.nativeEvent.getCoalescedEvents();

    const points = (samples.length === 0 ? [event.nativeEvent] : samples).map((sample) =>
      pointerPoint(sample, event.currentTarget, input.width, input.height),
    );

    input.onDraft(extendMark(input.draft, points));
  };

  const finish = (event: PointerEvent<SVGSVGElement>): void => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = undefined;

    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);

    if (input.draft === undefined) return;

    const mark = extendMark(input.draft, [
      pointerPoint(event.nativeEvent, event.currentTarget, input.width, input.height),
    ]);

    if (mark.kind !== "pen" && mark.from.x === mark.to.x && mark.from.y === mark.to.y) return;

    commit(mark);
  };

  const cancel = (event: PointerEvent<SVGSVGElement>): void => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = undefined;
    input.onDraft(undefined);
  };

  const navigate = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (!input.enabled || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Enter") {
      event.preventDefault();
      setKeyboard(true);

      if (input.draft === undefined) input.onDraft(startMark(input.tool, input.ink, point));
      else commit(input.draft);

      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

    event.preventDefault();
    setKeyboard(true);
    const step = event.shiftKey ? 20 : 5;

    const next = {
      x: Math.max(
        0,
        Math.min(
          input.width,
          point.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          input.height,
          point.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
        ),
      ),
      pressure: 0.5,
    };

    setPoint(next);

    if (input.draft !== undefined) input.onDraft(extendMark(input.draft, [next]));
  };

  const cursorRadius = Math.max(input.width, input.height) / 140;

  return (
    <>
      <span id={help} {...props(srOnly)}>
        Drag to draw, or click once for the start and once for the end of a shape. Arrow keys move
        the drawing point; Shift moves farther. Enter starts or finishes a mark. Escape cancels an
        unfinished mark, or closes the viewer.
      </span>
      <svg
        data-image-markup=""
        role={input.enabled ? "application" : "img"}
        aria-label={input.enabled ? "Image markup" : `${String(input.marks.length)} image marks`}
        aria-describedby={input.enabled ? help : undefined}
        aria-hidden={!input.enabled && input.marks.length === 0 ? true : undefined}
        tabIndex={input.enabled ? 0 : -1}
        viewBox={`0 0 ${input.width} ${input.height}`}
        {...props(styles.canvas, input.enabled && styles.drawing, input.enabled && focus.ringInset)}
        onFocus={() => setKeyboard(true)}
        onBlur={() => setKeyboard(false)}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={navigate}
      >
        {input.marks.map((mark, index) => (
          <InkMark
            key={index}
            mark={mark}
            width={input.width}
            height={input.height}
            dark={input.dark}
          />
        ))}
        {input.draft !== undefined && (
          <InkMark mark={input.draft} width={input.width} height={input.height} dark={input.dark} />
        )}
        {input.enabled && keyboard && (
          <g fill="none" pointerEvents="none" {...props(styles.cursor)}>
            <circle
              cx={point.x}
              cy={point.y}
              r={cursorRadius}
              stroke={markupLight}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={cursorRadius}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`M ${point.x - cursorRadius / 2} ${point.y} h ${cursorRadius} M ${point.x} ${point.y - cursorRadius / 2} v ${cursorRadius}`}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>
    </>
  );
}

function InkMark(input: {
  readonly mark: Mark;
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
}): ReactElement {
  const path = markPath(input.mark);
  const dot = markDot(input.mark);
  const width = markWidth(input.mark, input.width, input.height);

  return (
    <g
      data-image-mark={input.mark.kind}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props(styles.art)}
    >
      {input.dark && (
        <InkStroke
          path={path}
          dot={dot}
          color={markupLight}
          width={width * 1.6}
          opacity={markupOpacity.under}
          under
        />
      )}
      <g>
        <InkStroke
          path={path}
          dot={dot}
          color={markupInk[input.mark.ink]}
          width={width * 1.4}
          opacity={markupOpacity.halo}
        />
        <InkStroke
          path={path}
          dot={dot}
          color={markupInk[input.mark.ink]}
          width={width}
          opacity={markupOpacity.core}
        />
        {input.mark.kind === "pen" &&
          [input.mark.points[0], input.mark.points.at(-1) ?? input.mark.points[0]].map(
            (point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={width / 2}
                fill={markupInk[input.mark.ink]}
                stroke="none"
                opacity={markupOpacity.pool}
                {...props(styles.ink)}
              />
            ),
          )}
      </g>
    </g>
  );
}

function InkStroke(input: {
  readonly path: string;
  readonly dot: Point | undefined;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly under?: boolean;
}): ReactElement {
  const layer = {
    "data-mark-understroke": input.under ? "" : undefined,
    opacity: input.opacity,
    ...props(!input.under && styles.ink),
  };

  if (input.dot !== undefined)
    return (
      <circle cx={input.dot.x} cy={input.dot.y} r={input.width / 2} fill={input.color} {...layer} />
    );

  return <path d={input.path} stroke={input.color} strokeWidth={input.width} {...layer} />;
}

function pointerPoint(
  event: globalThis.PointerEvent,
  canvas: SVGSVGElement,
  width: number,
  height: number,
): Point {
  const box = canvas.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(width, ((event.clientX - box.left) / box.width) * width)),
    y: Math.max(0, Math.min(height, ((event.clientY - box.top) / box.height) * height)),
    pressure: event.pressure > 0 ? event.pressure : 0.5,
  };
}

function startMark(kind: Mark["kind"], ink: Ink, point: Point): Mark {
  if (kind === "pen") return { kind, ink, points: [point] };

  return { kind, ink, from: point, to: point };
}

function extendMark(mark: Mark, points: readonly Point[]): Mark {
  if (mark.kind === "pen")
    return { ...mark, points: [mark.points[0], ...mark.points.slice(1), ...points] };

  return { ...mark, to: points.at(-1) ?? mark.to };
}
