import { css, html } from "react-strict-dom";
import { controls, radii, spacing, tokens, typography } from "../theme.ts";

/**
 * Full-width in-content action. SwiftUI sizes a string-label button to its
 * text, so the form actions are drawn here instead: the row owns the width.
 */
export function PrimaryButton({
  label,
  onClick,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary";
}) {
  return (
    <html.button
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={[
        styles.button,
        tone === "primary" ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <html.span style={tone === "primary" ? styles.primaryLabel : styles.secondaryLabel}>
        {label}
      </html.span>
    </html.button>
  );
}

const styles = css.create({
  button: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    minHeight: controls.primaryHeight + 6,
    paddingInline: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 0,
  },
  primary: {
    backgroundColor: { default: tokens.primary, ":active": tokens.foreground },
  },
  secondary: {
    backgroundColor: { default: tokens.fill, ":active": tokens.separator },
  },
  disabled: { opacity: controls.disabledOpacity },
  primaryLabel: {
    ...typography.button,
    lineHeight: `${typography.button.lineHeight}px`,
    color: tokens.onPrimary,
  },
  secondaryLabel: {
    ...typography.button,
    lineHeight: `${typography.button.lineHeight}px`,
    color: tokens.foreground,
  },
});
