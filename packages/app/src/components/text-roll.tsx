import { create, keyframes, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
// oxlint-disable-next-line no-restricted-imports -- the roll timer follows the incoming text
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

const HOLD_MS = 1_200;

const rollIn = keyframes({
  from: { opacity: 0, transform: "translateY(calc(100% + 1px))" },
  to: { opacity: 1, transform: "none" },
});

const rollOut = keyframes({
  from: { transform: "none" },
  to: { transform: "translateY(calc(-100% - 1px))" },
});

const styles = create({
  root: {
    display: "inline-grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "clip",
  },
  rolling: {
    maskImage:
      "linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)",
  },
  item: {
    gridArea: "1 / 1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    animationDuration: "300ms",
    animationTimingFunction: "cubic-bezier(.215, .61, .355, 1)",
    animationFillMode: "both",
  },
  in: { animationName: rollIn },
  out: { animationName: rollOut },
});

interface Shown {
  readonly text: string;
  readonly outgoing: string | undefined;
  readonly at: number;
}

export function TextRoll({
  text,
  itemStyle,
}: {
  readonly text: string;
  readonly itemStyle?: StyleXStyles;
}): ReactElement {
  const [shown, setShown] = useState<Shown>(() => ({
    text,
    outgoing: undefined,
    at: performance.now(),
  }));

  useEffect(() => {
    if (text === shown.text) return undefined;

    const timer = window.setTimeout(
      () => {
        const still =
          shown.text === "" ||
          text === "" ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        setShown({ text, outgoing: still ? undefined : shown.text, at: performance.now() });
      },
      shown.at + HOLD_MS - performance.now(),
    );

    return () => window.clearTimeout(timer);
  }, [text, shown]);

  const rolling = shown.outgoing !== undefined;

  return (
    <span {...props(styles.root, rolling && styles.rolling)}>
      {rolling && (
        <span
          key="out"
          aria-hidden="true"
          onAnimationEnd={() => setShown((current) => ({ ...current, outgoing: undefined }))}
          {...props(styles.item, styles.out)}
        >
          <span {...props(itemStyle)}>{shown.outgoing}</span>
        </span>
      )}
      {shown.text !== "" && (
        <span key={shown.at} {...props(styles.item, rolling && styles.in)}>
          <span {...props(itemStyle)}>{shown.text}</span>
        </span>
      )}
    </span>
  );
}
