import type { ComponentProps } from "react";
import type { ViewStyle } from "react-native";
import { Button, Host } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  font,
  frame,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { controls, radii, spacing, themes, tokens, typography, useTheme } from "../theme.ts";

/** Label, action, and icon keep the names and types the native control uses. */
type Common = Required<Pick<ComponentProps<typeof Button>, "label" | "onPress">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    /** The action the screen is for: tinted with the accent rather than neutral. */
    prominent?: boolean;
  };

/**
 * A filling button spans its row, so the options that only make sense for a
 * self-sizing control — icon-only, compact, forced dark — are not offered with
 * it rather than being accepted and ignored.
 */
type GlassButtonProps =
  | (Common & { fill: true })
  | (Common & {
      fill?: false;
      iconOnly?: boolean;
      size?: "regular" | "compact";
      // Forced dark only for chrome drawn over dark content (annotate, camera).
      scheme?: "dark";
    });

/**
 * Every button that is not a list row.
 *
 * Toolbar and inline actions are the native glass control, which SwiftUI sizes
 * to its own label. A screen's full-width action cannot be: SwiftUI has no
 * `.infinity` across the bridge and a measured width arrives a frame late, so
 * `fill` draws the capsule from the shared tokens and lets the row own the width.
 */
export function GlassButton(props: GlassButtonProps) {
  const theme = useTheme();
  const { label, onPress, systemImage, disabled: isDisabled = false, prominent = false } = props;

  if (props.fill === true) {
    return (
      <html.button
        onClick={onPress}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        style={[
          styles.fill,
          prominent ? styles.prominent : styles.neutral,
          isDisabled && styles.disabled,
        ]}
      >
        {systemImage === undefined ? null : (
          <SymbolView
            name={systemImage}
            size={controls.icon}
            tintColor={prominent ? theme.onAccent : theme.foreground}
          />
        )}
        <html.span style={[styles.label, prominent ? styles.onAccent : styles.onNeutral]}>
          {label}
        </html.span>
      </html.button>
    );
  }

  const { iconOnly = false, size = "regular", scheme } = props;
  // Chrome forced to dark sits on a camera preview or a photo, so its tint comes
  // from the dark palette instead of the app's current appearance.
  const palette = scheme === "dark" ? themes.dark : theme;
  const height = size === "compact" ? controls.touchTarget : controls.primaryHeight;

  const hostStyle: ViewStyle = iconOnly
    ? { width: controls.touchTarget, height: controls.touchTarget }
    : { height };

  return (
    <Host
      style={hostStyle}
      matchContents={!iconOnly ? { horizontal: true } : false}
      colorScheme={scheme}
      ignoreSafeArea="all"
    >
      <Button
        label={label}
        systemImage={systemImage}
        onPress={onPress}
        modifiers={[
          frame({ minWidth: controls.touchTarget, minHeight: height }),
          buttonStyle(prominent ? "glassProminent" : "glass"),
          controlSize("regular"),
          buttonBorderShape(iconOnly ? "circle" : "capsule"),
          tint(prominent ? palette.accent : palette.foreground),
          font(
            iconOnly
              ? { size: typography.title.fontSize, weight: "regular" }
              : { size: typography.button.fontSize, weight: "medium" },
          ),
          labelStyle(iconOnly ? "iconOnly" : systemImage ? "titleAndIcon" : "titleOnly"),
          disabled(isDisabled),
        ]}
      />
    </Host>
  );
}

const styles = css.create({
  fill: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    gap: spacing.sm,
    minHeight: controls.fillHeight,
    paddingInline: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 0,
  },
  prominent: {
    backgroundColor: tokens.accent,
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
  neutral: { backgroundColor: { default: tokens.fill, ":active": tokens.separator } },
  disabled: { opacity: controls.disabledOpacity },
  label: {
    ...typography.button,
    lineHeight: `${typography.button.lineHeight}px`,
  },
  onAccent: { color: tokens.onAccent },
  onNeutral: { color: tokens.foreground },
});
