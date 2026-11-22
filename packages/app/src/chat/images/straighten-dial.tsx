import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { control, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { imageViewer } from "../../theme/schema.stylex.ts";
import { MAX_ANGLE, clamp } from "./markup-geometry.ts";
import { tween } from "./markup-tween.ts";

const PX_PER_DEGREE = 4;

const TICKS = Array.from({ length: 41 }, (_, index) => -MAX_ANGLE + index * 2.25);

const FADE = 32;

const PICKUP = 10;

const SNAP = 1;

const THROW_MS = 325;

const styles = create({
  dial: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flex: 1,
    minWidth: 0,
  },
  value: {
    margin: 0,
    flexShrink: 0,
    minWidth: "6ch",
    color: role.contentPrimary,
    fontVariantNumeric: "tabular-nums",
    fontWeight: type.weightMedium,
  },
  ruler: {
    position: "relative",
    flex: 1,
    minWidth: imageViewer.dialMinWidth,
    maxWidth: imageViewer.dialMaxWidth,
    height: `calc(${space.s8} + ${space.s2})`,
    overflowX: "clip",
    overflowY: "visible",
    touchAction: "pan-y",
    cursor: { default: "grab", ":active": "grabbing" },
    borderRadius: radius.control,
    userSelect: "none",
  },
  tick: (x: number, fade: number) => ({
    position: "absolute",
    insetBlockStart: "50%",
    left: "50%",
    width: space.px,
    height: glyph.sm,
    backgroundColor: role.contentQuaternary,
    transform: `translate(calc(${x}px - 50%), -50%)`,
    opacity: fade,
  }),
  major: { backgroundColor: role.contentSecondary },
  center: {
    position: "absolute",
    insetBlockEnd: `calc(${space.s0_5} + ${space.px})`,
    left: "50%",
    translate: "-50% 0",
    width: space.s0_5,
    height: control.heightMd,
    borderRadius: radius.pill,
    backgroundColor: role.contentPrimary,
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
  },
  dragging: { backgroundColor: role.bgInteractiveStrong },
  dot: (x: number) => ({
    position: "absolute",
    insetBlockStart: space.s0_5,
    left: "50%",
    width: space.s1_5,
    height: space.s1_5,
    borderRadius: radius.pill,
    backgroundColor: role.contentPrimary,
    transform: `translateX(calc(${x}px - 50%))`,
  }),
});

export function StraightenDial(input: {
  readonly angle: number;
  readonly onStart: () => void;
  readonly onChange: (angle: number) => void;
  readonly onEnd: () => void;
}): ReactElement {
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);

  const [measure] = useState(() => (element: HTMLDivElement | null) => {
    if (element === null) return;

    const observer = new ResizeObserver(() => setWidth(element.clientWidth));

    observer.observe(element);

    return () => observer.disconnect();
  });

  const gesture = useRef<{
    readonly pointer: number;
    readonly x: number;
    readonly angle: number;
    picked: boolean;
    offset: number;
    hold: number | undefined;
    last: number;
    samples: { readonly time: number; readonly angle: number }[];
  } | null>(null);

  const active = useRef(false);
  const glide = useRef<() => void>(() => undefined);

  useMountEffect(() => () => glide.current());

  const begin = (): void => {
    glide.current();

    if (active.current) return;
    active.current = true;
    input.onStart();
  };

  const end = (): void => {
    if (!active.current) return;
    active.current = false;
    input.onEnd();
  };

  const settleTo = (from: number, to: number, duration: number): void => {
    glide.current = tween(duration, (t) => input.onChange(from + (to - from) * t), end);
  };

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    glide.current();
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      angle: input.angle,
      picked: active.current,
      offset: 0,
      hold: undefined,
      last: input.angle,
      samples: [],
    };
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = gesture.current;

    if (drag === null || drag.pointer !== event.pointerId) return;

    const moved = drag.x - event.clientX;

    if (!drag.picked) {
      if (Math.abs(moved) < PICKUP) return;
      drag.picked = true;
      drag.offset = (-Math.sign(moved) * PICKUP) / PX_PER_DEGREE;
      drag.hold = drag.angle === 0 ? -drag.offset : undefined;
      begin();
      setDragging(true);
    }

    const raw = drag.angle + moved / PX_PER_DEGREE;
    const next = catchZero(drag, raw);
    drag.last = next;
    drag.samples = [...drag.samples, { time: event.timeStamp, angle: next }].slice(-6);
    input.onChange(rubber(next));
  };

  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = gesture.current;

    if (drag === null || drag.pointer !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);

    if (!drag.picked) return;

    const resting = rubber(drag.last);
    const first = drag.samples.find((sample) => event.timeStamp - sample.time < 90);

    const velocity =
      first === undefined || event.timeStamp === first.time
        ? 0
        : (drag.last - first.angle) / (event.timeStamp - first.time);

    if (Math.abs(velocity) < 0.02) {
      if (resting !== clamp(resting, -MAX_ANGLE, MAX_ANGLE)) {
        settleTo(resting, clamp(resting, -MAX_ANGLE, MAX_ANGLE), 380);
      } else end();

      return;
    }

    const thrown = clamp(resting + velocity * THROW_MS, -MAX_ANGLE, MAX_ANGLE);
    settleTo(resting, Math.abs(thrown) < SNAP ? 0 : Math.round(thrown * 10) / 10, 650);
  };

  const cancel = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = gesture.current;

    if (drag === null || drag.pointer !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);

    if (!drag.picked) return;
    input.onChange(drag.angle);
    end();
  };

  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1;

    const next = {
      ArrowLeft: input.angle - step,
      ArrowDown: input.angle - step,
      ArrowRight: input.angle + step,
      ArrowUp: input.angle + step,
      PageUp: input.angle + 10,
      PageDown: input.angle - 10,
      Home: -MAX_ANGLE,
      End: MAX_ANGLE,
      "0": 0,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    begin();
    input.onChange(clamp(Math.round(next * 10) / 10, -MAX_ANGLE, MAX_ANGLE));
    end();
  };

  const offset = -input.angle * PX_PER_DEGREE;
  const half = width / 2;

  return (
    <div {...props(styles.dial)}>
      <div
        ref={measure}
        role="slider"
        tabIndex={0}
        aria-label="Straighten"
        aria-valuemin={-MAX_ANGLE}
        aria-valuemax={MAX_ANGLE}
        aria-valuenow={Math.round(input.angle * 10) / 10}
        aria-valuetext={`${(Math.round(input.angle * 10) / 10).toFixed(1)} degrees`}
        data-dragging={dragging ? "" : undefined}
        {...props(styles.ruler, focus.ring)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onKeyDown={key}
      >
        {TICKS.map((angle, index) => {
          const x = angle * PX_PER_DEGREE + offset;

          return (
            <span
              key={angle}
              aria-hidden="true"
              {...props(
                styles.tick(x, clamp((half - Math.abs(x)) / FADE, 0, 1)),
                index % 10 === 0 && styles.major,
              )}
            />
          );
        })}
        {input.angle !== 0 && <span aria-hidden="true" {...props(styles.dot(offset))} />}
        <span aria-hidden="true" {...props(styles.center, dragging && styles.dragging)} />
      </div>
      <p aria-hidden="true" {...props(text.sm, styles.value)}>
        {formatAngle(input.angle)}
      </p>
    </div>
  );
}

function catchZero(
  drag: { offset: number; hold: number | undefined; last: number },
  raw: number,
): number {
  if (drag.hold !== undefined) {
    const travel = raw - drag.hold;

    if (Math.abs(travel) < SNAP) return 0;
    drag.offset = -drag.hold - Math.sign(travel) * SNAP;
    drag.hold = undefined;

    return raw + drag.offset;
  }

  const value = raw + drag.offset;

  if (drag.last !== 0 && Math.sign(value) !== Math.sign(drag.last)) {
    drag.hold = -drag.offset;

    return Math.abs(value) < SNAP ? 0 : catchZero(drag, raw);
  }

  return value;
}

function rubber(angle: number): number {
  const limit = clamp(angle, -MAX_ANGLE, MAX_ANGLE);

  return limit + (angle - limit) / 3;
}

function formatAngle(angle: number): string {
  const tenths = Math.round(angle * 10) / 10;

  return `${tenths < 0 ? "\u2212" : ""}${Math.abs(tenths).toFixed(1)}°`;
}
