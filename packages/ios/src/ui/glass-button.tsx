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
import { controls, themes, useTheme, typography } from "../theme.ts";

type GlassButtonProps = Required<Pick<ComponentProps<typeof Button>, "label" | "onPress">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    iconOnly?: boolean;
    size?: "regular" | "compact";
    prominent?: boolean;
    // Forced dark only for chrome drawn over dark content (annotate, camera).
    scheme?: "dark";
  };

export function GlassButton({
  label,
  onPress,
  systemImage,
  disabled: isDisabled = false,
  iconOnly = false,
  size = "regular",
  prominent = false,
  scheme,
}: GlassButtonProps) {
  const theme = useTheme();
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
          tint(prominent ? palette.primary : palette.foreground),
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
