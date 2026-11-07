import { create, props, when } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { AnimatedNumber } from "./animated-number.tsx";
import { controlRoot } from "@nyte-ai/ui/styles/control.stylex";

const styles = create({
  stats: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  count: {
    color: {
      default: role.contentAccent,
      [when.ancestor(
        ":is([data-change-stats-control]):is(:active, [aria-expanded=true], [data-pressed], [data-highlighted]):not(:disabled, [data-disabled])",
        controlRoot,
      )]: "inherit",
    },
  },
});

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
