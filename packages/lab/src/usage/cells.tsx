/** A figure cell and the tone its change takes: good, bad, or neutral by which way is up. */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { intent } from "@nyte-ai/ui/surface-theme";
import { delta } from "./format";
import { styles } from "./page.stylex";

type Tone = "neutral" | "good" | "bad";

export const TONE_SCOPE = { neutral: null, good: intent.success, bad: intent.danger } as const;

export function Cell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: Tone;
}): ReactElement {
  return (
    <div {...props(styles.cell)}>
      <span {...props(styles.cellLabel)}>{label}</span>
      <span {...props(styles.cellValue)}>{value}</span>
      <span {...props(TONE_SCOPE[tone], styles.cellSub, tone !== "neutral" && styles.toned)}>
        {sub ?? "\u00a0"}
      </span>
    </div>
  );
}

export function toneOf(sign: -1 | 0 | 1, upIsGood: boolean): Tone {
  if (sign === 0) return "neutral";

  return sign > 0 === upIsGood ? "good" : "bad";
}

export function changeOf({
  current,
  previous,
  upIsGood = false,
}: {
  readonly current: number;
  readonly previous: number;
  readonly upIsGood?: boolean;
}) {
  const change = delta(current, previous);

  return { sub: change.text, tone: toneOf(change.sign, upIsGood) };
}
