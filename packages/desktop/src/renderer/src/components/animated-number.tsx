import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { TextMorph } from "torph";

const styles = create({
  number: {
    display: "inline-block",
    position: "relative",
    clipPath: "inset(0)",
    fontVariantNumeric: "tabular-nums",
  },
  // The current value owns layout and accessibility, never an animation frame.
  value: { opacity: 0 },
  morph: { position: "absolute", top: 0, left: 0 },
});

/** Mounts are static; only value updates morph. */
export function AnimatedNumber({ value }: { readonly value: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const morph = useRef<TextMorph | null>(null);

  useLayoutEffect(() => {
    const node = element.current;

    if (node === null) return;
    const style = getComputedStyle(node);
    const durationToken = style.getPropertyValue("--nyte-duration-normal").trim();
    const duration = Number.parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
    const ease = style.getPropertyValue("--nyte-easing-out").trim();

    if (!Number.isFinite(duration) || duration <= 0 || ease === "") return;
    const instance = new TextMorph({ element: node, duration, ease, numbers: true });
    morph.current = instance;

    return () => {
      node.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      instance.destroy();
      node.replaceChildren();
      morph.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    // String preserves the ungrouped counts used by filename premeasurement.
    if (morph.current !== null) morph.current.update(String(value));
    else if (element.current !== null) element.current.textContent = String(value);
  }, [value]);

  return (
    <span {...props(styles.number)}>
      <span {...props(styles.value)}>{String(value)}</span>
      <span aria-hidden="true" {...props(styles.morph)}>
        <span ref={element} />
      </span>
    </span>
  );
}
