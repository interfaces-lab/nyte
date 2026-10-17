import { glyph, radius, space } from "./styles/schema.stylex.ts";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { text } from "./styles/text.stylex.ts";
import { motion, role, type } from "./styles/vars.stylex.ts";

const styles = create({
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s0_5,
    flexShrink: 0,
    paddingBlock: space.px,
    paddingInline: space.s1,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontWeight: type.weightRegular,
    fontVariantLigatures: "none",
    whiteSpace: "nowrap",
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationInstant,
  },
  plain: { padding: 0, backgroundColor: "transparent" },
  keycap: {
    minWidth: glyph.md,
    minHeight: glyph.md,
    padding: 0,
    borderRadius: radius.indicator,
    fontFamily: type.fontSans,
  },
  held: { backgroundColor: role.bgInteractivePrimaryTranslucent, color: role.contentPrimary },
});

export type KbdProps = Omit<StyledProps<ComponentProps<"kbd">, Restyle<"Kbd">>, "children"> & {
  readonly keys: readonly string[];
  /** Drops the fill and padding, for a shortcut beside other row metadata. */
  readonly plain?: boolean;
  /** A square cap in the UI face, one per key. */
  readonly keycap?: boolean;
  /** Lights the key while it is held down. */
  readonly held?: boolean;
};

export function Kbd({
  keys,
  plain = false,
  keycap = false,
  held = false,
  className,
  style,
  xstyle,
  ...rest
}: KbdProps): ReactElement {
  return (
    <kbd
      {...rest}
      {...mergeStyleProps(
        props(
          text.sm,
          styles.kbd,
          plain && styles.plain,
          keycap && styles.keycap,
          held && styles.held,
          xstyle,
        ),
        className,
        style,
      )}
    >
      {keys.map((key) => (
        <span key={key}>{key}</span>
      ))}
    </kbd>
  );
}
