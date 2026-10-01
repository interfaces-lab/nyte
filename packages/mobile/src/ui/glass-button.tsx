import type { ComponentProps } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { Link, router, type Href } from "expo-router";
import { Button, Host } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
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
type Common = Required<Pick<ComponentProps<typeof Button>, "label">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    busy?: boolean;
    /** The action the screen is for: tinted with the accent rather than neutral. */
    prominent?: boolean;
  } & ({ onPress: () => void; href?: never } | { href: Href; onPress?: never });

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
  const {
    label,
    systemImage,
    disabled: isDisabled = false,
    busy = false,
    prominent = false,
  } = props;
  function activate() {
    if (isDisabled || busy) return;
    if (props.href !== undefined) {
      router.navigate(props.href);
      return;
    }
    props.onPress();
  }

  if (props.fill === true) {
    const style = [
      styles.fill,
      prominent ? styles.prominent : styles.neutral,
      isDisabled && styles.disabled,
    ];
    const content = (
      <>
        {systemImage === undefined ? null : (
          <SymbolView
            name={systemImage}
            size={controls.icon}
            tintColor={prominent ? theme.onAccentFill : theme.foreground}
          />
        )}
        <html.span style={[styles.label, prominent ? styles.onAccentFill : styles.onNeutral]}>
          {label}
        </html.span>
      </>
    );
    if (props.href !== undefined) {
      return (
        <Link
          href={props.href}
          asChild
          onPress={(event) => {
            if (isDisabled || busy) event.preventDefault();
          }}
        >
          <Pressable accessibilityRole="link" accessibilityState={{ disabled: isDisabled, busy }}>
            <html.div style={style}>{content}</html.div>
          </Pressable>
        </Link>
      );
    }
    return (
      <html.button
        onClick={activate}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        style={style}
      >
        {content}
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
    <View
      accessible
      accessibilityRole={props.href === undefined ? "button" : "link"}
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy }}
      onAccessibilityTap={activate}
    >
      <Host
        style={hostStyle}
        matchContents={!iconOnly ? { horizontal: true } : false}
        colorScheme={scheme}
        ignoreSafeArea="all"
      >
        <Button
          label={label}
          systemImage={systemImage}
          onPress={activate}
          modifiers={[
            accessibilityHidden(),
            frame({ minWidth: controls.touchTarget, minHeight: height }),
            buttonStyle(prominent ? "glassProminent" : "glass"),
            controlSize("regular"),
            buttonBorderShape(iconOnly ? "circle" : "capsule"),
            tint(prominent ? palette.accentFill : palette.foreground),
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
    </View>
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
    backgroundColor: tokens.accentFill,
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
  neutral: { backgroundColor: { default: tokens.fill, ":active": tokens.separator } },
  disabled: { opacity: controls.disabledOpacity },
  label: {
    ...typography.button,
    lineHeight: `${typography.button.lineHeight}px`,
  },
  onAccentFill: { color: tokens.onAccentFill },
  onNeutral: { color: tokens.foreground },
});
