import type { ComponentProps } from "react";
import type { ViewStyle } from "react-native";
import { Button, Host, Label } from "@expo/ui/swift-ui";
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
import { controls, nativeTheme, typography } from "../theme.ts";

type GlassButtonProps = Required<Pick<ComponentProps<typeof Button>, "label" | "onPress">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    prominent?: boolean;
    iconOnly?: boolean;
    fullWidth?: boolean;
  };

export function GlassButton({
  label,
  onPress,
  systemImage,
  disabled: isDisabled = false,
  prominent = false,
  iconOnly = false,
  fullWidth = false,
}: GlassButtonProps) {
  const hostStyle: ViewStyle = fullWidth
    ? { width: "100%", height: controls.primaryHeight }
    : iconOnly
      ? { width: controls.touchTarget, height: controls.touchTarget }
      : { height: controls.primaryHeight };

  return (
    <Host
      style={hostStyle}
      matchContents={!fullWidth && !iconOnly ? { horizontal: true } : false}
      colorScheme="dark"
      ignoreSafeArea="all"
    >
      <Button
        label={fullWidth ? undefined : label}
        systemImage={systemImage}
        onPress={onPress}
        modifiers={[
          buttonStyle(prominent ? "glassProminent" : "glass"),
          controlSize(fullWidth ? "extraLarge" : "large"),
          buttonBorderShape(iconOnly ? "circle" : "capsule"),
          tint(prominent ? nativeTheme.accent : nativeTheme.foreground),
          font({ size: typography.title.fontSize, weight: controls.iconWeight }),
          labelStyle(iconOnly ? "iconOnly" : systemImage ? "titleAndIcon" : "titleOnly"),
          disabled(isDisabled),
          frame({ minWidth: controls.touchTarget, minHeight: controls.touchTarget }),
        ]}
      >
        {/* Native Button ignores children when label is set. Its label must fill the glass. */}
        {fullWidth ? (
          <Label
            title={label}
            systemImage={systemImage}
            modifiers={[frame({ maxWidth: Infinity })]}
          />
        ) : undefined}
      </Button>
    </Host>
  );
}
