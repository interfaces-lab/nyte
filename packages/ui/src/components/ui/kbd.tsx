import { create, props } from "@stylexjs/stylex";
import type { CSSProperties, ReactElement } from "react";

import { mergeStyleProps, type XStyle } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    minHeight: 18,
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: t.radiusBase,
    backgroundColor: t.fillQuiet,
    color: t.textSecondary,
    fontSize: t.fontSm,
    fontFamily: t.fontMono,
    fontWeight: 400,
    fontVariantLigatures: "none",
    letterSpacing: 0,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
  },
  plain: { padding: 0, backgroundColor: "transparent" },
});

export interface KbdProps {
  readonly keys: readonly string[];
  /** Drops the fill and padding, for a shortcut beside other row metadata. */
  readonly plain?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

export function Kbd({ keys, plain = false, className, style, xstyle }: KbdProps): ReactElement {
  return (
    <kbd {...mergeStyleProps(props(styles.kbd, plain && styles.plain, xstyle), className, style)}>
      {keys.map((key) => (
        <span key={key}>{key}</span>
      ))}
    </kbd>
  );
}
