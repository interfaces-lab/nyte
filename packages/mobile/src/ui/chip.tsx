import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { controls, radii, textStyles, tokens } from "../theme.ts";

/** The bordered pill used for actions that sit above the composer. */
export function Chip({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <html.button
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={[styles.chip, disabled && styles.disabled]}
    >
      <html.span style={textStyles.label}>{children}</html.span>
    </html.button>
  );
}

const styles = css.create({
  chip: {
    display: "flex",
    flexDirection: "column",
    height: controls.chipHeight,
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
