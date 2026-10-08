"use client";

import { IconChevronLeft, IconChevronRight } from "central-icons";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Fingerprint } from "./fingerprint";
import { HARNESSES, harnessMeta, type Harness } from "./harnesses";

const COUNT = HARNESSES.length;
const STEP = 360 / COUNT;
/* Neighbouring cards sit one gap apart on the ring, whatever the card width. */
const RADIUS = `calc((var(--card-w) + var(--card-gap)) / ${2 * Math.tan(Math.PI / COUNT)})`;
const DEGREES_PER_PIXEL = 0.22;

const buttonClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 ring-inset outline-none backdrop-blur-sm transition-[background-color,scale] duration-150 hover:bg-white/16 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white";

interface Drag {
  x: number;
  angle: number;
}

function frontIndex(angle: number): number {
  return ((Math.round(-angle / STEP) % COUNT) + COUNT) % COUNT;
}

function Card({ harness, index, angle }: { harness: Harness; index: number; angle: number }) {
  const theta = index * STEP;
  const fromFront = Math.abs(((((theta + angle + 180) % 360) + 360) % 360) - 180);
  return (
    <div
      data-front={fromFront < STEP / 2 || undefined}
      style={{
        transform: `translate(-50%, -50%) rotateY(${theta}deg) translateZ(${RADIUS})`,
        opacity: 1 - (Math.min(fromFront, 90) / 90) * 0.55,
      }}
      className="absolute top-1/2 left-1/2 w-(--card-w) overflow-clip rounded-[12px] bg-(--plate-ink)/50 p-0.5 shadow-[0_24px_40px_-20px_rgb(0_0_40/0.6)] ring-1 ring-white/15 ring-inset backface-hidden transition-shadow duration-600 ease-nav data-front:ring-white/70"
    >
      <Fingerprint
        seed={harness.name}
        cols={48}
        rows={36}
        pixel={3}
        className="block h-auto w-full rounded-[10px] text-white"
      />
      <span className="absolute bottom-2 left-2.5 font-mono text-[10px]/none text-white/80">
        {harness.name}
      </span>
    </div>
  );
}

/*
 * The harnesses as cards on a ring, one facing the visitor. Drag the ring,
 * press the arrows, or use the arrow keys; the caption follows the front card.
 */
export function HarnessRing() {
  const drag = useRef<Drag>(null);
  const [angle, setAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const harness = HARNESSES[frontIndex(angle)];

  const show = (delta: number) =>
    setAngle((current) => (Math.round(-current / STEP) + delta) * -STEP);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, angle };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setAngle(drag.current.angle + (event.clientX - drag.current.x) * DEGREES_PER_PIXEL);
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setAngle((current) => Math.round(current / STEP) * STEP);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      show(1);
    }
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className="[--card-gap:12px] [--card-h:78px] [--card-w:104px] sm:[--card-h:111px] sm:[--card-w:148px]"
    >
      <div
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-[calc(var(--card-h)+56px)] cursor-grab touch-pan-y select-none perspective-[1400px] [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)] active:cursor-grabbing"
      >
        <div
          style={{ transform: `translateZ(calc(-1 * ${RADIUS}))` }}
          className="absolute inset-0 transform-3d"
        >
          <div className="absolute inset-0 transform-3d animate-ring-settle motion-reduce:animate-none">
            <div
              style={{ transform: `rotateY(${angle}deg)` }}
              className={`absolute inset-0 transform-3d ease-nav motion-reduce:transition-none ${dragging ? "" : "transition-transform duration-600"}`}
            >
              {HARNESSES.map((item, index) => (
                <Card key={item.name} harness={item} index={index} angle={angle} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 px-(--site-pad)">
        <button
          type="button"
          aria-label="Previous harness"
          onClick={() => show(-1)}
          className={buttonClass}
        >
          <IconChevronLeft size={16} />
        </button>
        <p aria-live="polite" className="min-w-0 text-center text-[14px]/5 sm:min-w-[20rem]">
          <span
            key={harness.name}
            className="inline-block animate-caption-in motion-reduce:animate-none"
          >
            <span className="font-medium">{harness.name}</span>
            <span className="font-mono text-[12px] text-white/60"> · {harnessMeta(harness)}</span>
          </span>
        </p>
        <button
          type="button"
          aria-label="Next harness"
          onClick={() => show(1)}
          className={buttonClass}
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
