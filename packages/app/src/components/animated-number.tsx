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
  value: { opacity: 0 },
  morph: { position: "absolute", top: 0, left: 0 },
});

export function AnimatedNumber({ value }: { readonly value: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const morph = useRef<TextMorph | null>(null);
  const shown = useRef<number | null>(null);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- releases the torph morph the value effect may have created
  useLayoutEffect(() => {
    const node = element.current;

    return () => {
      const instance = morph.current;

      if (node === null || instance === null) return;
      node.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      instance.destroy();
      node.replaceChildren();
      morph.current = null;
    };
  }, []);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- animates the torph morph to the new value before paint
  useLayoutEffect(() => {
    const node = element.current;

    if (node === null) return;
    const previous = shown.current;
    shown.current = value;

    if (morph.current === null && previous !== null && previous !== value) {
      morph.current = createMorph(node, previous);
    }

    if (morph.current !== null) morph.current.update(String(value));
    else node.textContent = String(value);
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

function createMorph(node: HTMLSpanElement, previous: number): TextMorph | null {
  const style = getComputedStyle(node);
  const durationToken = style.getPropertyValue("--nyte-duration-normal").trim();
  const duration = Number.parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
  const ease = style.getPropertyValue("--nyte-easing-out").trim();

  if (!Number.isFinite(duration) || duration <= 0 || ease === "") return null;
  node.replaceChildren();
  const instance = new TextMorph({ element: node, duration, ease, numbers: true });
  instance.update(String(previous));

  return instance;
}
