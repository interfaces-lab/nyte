"use client";

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { skyBox, skyLayer } from "./sky-layer";

/*
 * A lens over the sky: a round window that follows the pointer and shows the
 * same field at a higher opacity. The window and the field inside it move by
 * opposite transforms, so the glyphs stay registered with the sky underneath
 * and the big text layer is never repainted.
 */
const SIZE = 320;
const HALF = SIZE / 2;

export function SkyLight({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [field, setField] = useState({ width: 0, height: 0 });
  const pointerX = useMotionValue(-SIZE);
  const pointerY = useMotionValue(-SIZE);
  const x = useSpring(pointerX, { stiffness: 260, damping: 32, mass: 0.6 });
  const y = useSpring(pointerY, { stiffness: 260, damping: 32, mass: 0.6 });
  const shown = useMotionValue(0);
  const opacity = useSpring(shown, { stiffness: 120, damping: 24 });
  const insideX = useTransform(x, (value) => -value);
  const insideY = useTransform(y, (value) => -value);

  useEffect(() => {
    const field = ref.current?.parentElement;
    if (!field || !window.matchMedia("(hover: hover)").matches) return;
    /* The field inside the lens has to match the sky's size to stay registered. */
    const observer = new ResizeObserver(([entry]) =>
      setField({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(field);
    const move = (event: PointerEvent) => {
      const box = field.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      shown.set(inside ? 1 : 0);
      pointerX.set(event.clientX - box.left - HALF);
      pointerY.set(event.clientY - box.top - HALF);
    };
    const leave = () => shown.set(0);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [pointerX, pointerY, shown]);

  return (
    <motion.div
      ref={ref}
      className="absolute top-0 left-0 overflow-hidden rounded-full dark:hidden [mask-image:radial-gradient(closest-side,black_35%,transparent)]"
      style={{ width: SIZE, height: SIZE, x, y, opacity }}
    >
      <motion.div
        className="absolute top-0 left-0"
        style={{ x: insideX, y: insideY, width: field.width, height: field.height }}
      >
        <pre className={`${skyLayer} opacity-60`} style={skyBox}>
          {text}
        </pre>
      </motion.div>
    </motion.div>
  );
}
