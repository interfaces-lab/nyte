import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { AnimatedNumber } from "../components/animated-number.tsx";

const styles = create({
  stats: {
    display: "inline-flex",
    gap: space.s1_5,
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: type.weightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
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
        <span {...props(intent.success, styles.added)}>
          +<AnimatedNumber value={added} />
        </span>
      )}
      {removed > 0 && (
        <span {...props(intent.danger, styles.removed)}>
          -<AnimatedNumber value={removed} />
        </span>
      )}
    </span>
  );
}
