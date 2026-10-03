import { radius } from "./schema.stylex.ts";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { role, type } from "./vars.stylex.ts";

const styles = create({
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontFamily: type.fontMono,
    fontWeight: 400,
    fontVariantLigatures: "none",
    letterSpacing: 0,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
  plain: { padding: 0, backgroundColor: "transparent" },
});

export type KbdProps = Omit<StyledProps<ComponentProps<"kbd">>, "children"> & {
  readonly keys: readonly string[];
  /** Drops the fill and padding, for a shortcut beside other row metadata. */
  readonly plain?: boolean;
};

export function Kbd({
  keys,
  plain = false,
  className,
  style,
  xstyle,
  ...rest
}: KbdProps): ReactElement {
  return (
    <kbd
      {...rest}
      {...mergeStyleProps(props(styles.kbd, plain && styles.plain, xstyle), className, style)}
    >
      {keys.map((key) => (
        <span key={key}>{key}</span>
      ))}
    </kbd>
  );
}
