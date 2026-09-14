import type { ComponentProps } from "react";
import type { ViewStyle } from "react-native";
import { Button, Host } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  containerRelativeFrame,
  controlSize,
  disabled,
  font,
  frame,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { controls, useTheme, typography } from "../theme.ts";

type GlassButtonProps = Required<Pick<ComponentProps<typeof Button>, "label" | "onPress">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    iconOnly?: boolean;
    fill?: boolean;
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
  fill = false,
  size = "regular",
  prominent = false,
  scheme,
}: GlassButtonProps) {
  const theme = useTheme();
  const height = size === "compact" ? controls.touchTarget : controls.primaryHeight;
  const hostStyle: ViewStyle = iconOnly
    ? { width: controls.touchTarget, height: controls.touchTarget }
    : fill
      ? { width: "100%", height }
      : { height };
  const sizing = fill
    ? [containerRelativeFrame({ axes: "horizontal" }), frame({ minHeight: height })]
    : [frame({ minWidth: controls.touchTarget, minHeight: height })];

  return (
    <Host
      style={hostStyle}
      matchContents={!iconOnly && !fill ? { horizontal: true } : false}
      colorScheme={scheme}
      ignoreSafeArea="all"
    >
      <Button
        label={label}
        systemImage={systemImage}
        onPress={onPress}
        modifiers={[
          buttonStyle(prominent ? "glassProminent" : "glass"),
          controlSize("regular"),
          buttonBorderShape(iconOnly ? "circle" : "capsule"),
          tint(prominent ? theme.primary : theme.foreground),
          font(
            iconOnly
              ? { size: typography.title.fontSize, weight: "regular" }
              : { size: typography.button.fontSize, weight: "medium" },
          ),
          labelStyle(iconOnly ? "iconOnly" : systemImage ? "titleAndIcon" : "titleOnly"),
          disabled(isDisabled),
          ...sizing,
        ]}
      />
    </Host>
  );
}
