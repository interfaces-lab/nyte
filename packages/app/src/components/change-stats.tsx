import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { AnimatedNumber } from "./animated-number.tsx";

const styles = create({
  stats: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  count: { color: role.contentAccent },
});

/** The hue carries the meaning, so each count takes its scope's accent ink. */
export function ChangeStats({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}): ReactElement | null {
  if (added === 0 && removed === 0) return null;

  return (
    <span
      aria-label={`${String(added)} added, ${String(removed)} removed`}
      {...props(styles.stats)}
    >
      {added > 0 && (
        <span {...props(intent.success, styles.count)}>
          +<AnimatedNumber value={added} />
        </span>
      )}
      {removed > 0 && (
        <span {...props(intent.danger, styles.count)}>
          -<AnimatedNumber value={removed} />
        </span>
      )}
    </span>
  );
}
