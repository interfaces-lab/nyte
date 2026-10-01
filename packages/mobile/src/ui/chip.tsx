import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Link, type Href } from "expo-router";
import { css, html } from "react-strict-dom";
import { controls, radii, textStyles, tokens } from "../theme.ts";

/** The bordered pill used for actions that sit above the composer. */
export function Chip({
  children,
  onClick,
  href,
  selected,
  busy = false,
  disabled = false,
}: {
  children: ReactNode;
  selected?: boolean;
  busy?: boolean;
  disabled?: boolean;
} & ({ onClick: () => void; href?: never } | { href: Href; onClick?: never })) {
  const style = [styles.chip, disabled && styles.disabled];
  const content = <html.span style={textStyles.label}>{children}</html.span>;
  if (href !== undefined) {
    return (
      <Link
        href={href}
        asChild
        onPress={(event) => {
          if (disabled || busy) event.preventDefault();
        }}
      >
        <Pressable accessibilityRole="link" accessibilityState={{ disabled, busy, selected }}>
          <html.div style={style}>{content}</html.div>
        </Pressable>
      </Link>
    );
  }
  return (
    <html.button
      onClick={() => {
        if (!busy) onClick();
      }}
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={busy}
      aria-pressed={selected}
      style={style}
    >
      {content}
    </html.button>
  );
}

const styles = css.create({
  chip: {
    display: "flex",
    flexDirection: "column",
    minHeight: controls.touchTarget,
    paddingInline: 14,
    borderRadius: radii.pill,
    backgroundColor: tokens.surface,
    borderWidth: controls.hairline,
    borderColor: tokens.border,
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
    fontSize: "inherit",
    ":active": { opacity: 0.7 },
  },
  disabled: { opacity: controls.disabledOpacity },
});
