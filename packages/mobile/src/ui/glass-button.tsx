import type { ComponentProps } from "react";
import { View } from "react-native";
import { router, type Href } from "expo-router";
import { Host } from "@expo/ui";
import { Button, Label } from "@expo/ui/swift-ui";
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
import { controls, themes, useTheme } from "../theme.ts";

type Common = Required<Pick<ComponentProps<typeof Button>, "label">> &
  Pick<ComponentProps<typeof Button>, "systemImage"> & {
    disabled?: boolean;
    busy?: boolean;
    prominent?: boolean;
  } & ({ onPress: () => void; href?: never } | { href: Href; onPress?: never });

type GlassButtonProps =
  | (Common & { fill: true })
  | (Common & {
      fill?: false;
      iconOnly?: boolean;
      size?: "regular" | "compact";
      scheme?: "dark";
    });

export function GlassButton(props: GlassButtonProps) {
  const theme = useTheme();
  const filling = props.fill === true;

  const iconOnly =
    props.fill !== true && props.iconOnly === true && props.systemImage !== undefined;

  const scheme = props.fill === true ? undefined : props.scheme;
  const palette = scheme === "dark" ? themes.dark : theme;
  const unavailable = props.disabled === true || props.busy === true;
  const height = filling ? controls.fillHeight : controls.touchTarget;

  function activate() {
    if (unavailable) return;

    if (props.href !== undefined) {
      router.navigate(props.href);

      return;
    }

    props.onPress();
  }

  return (
    <View
      style={filling ? { alignSelf: "stretch" } : undefined}
      accessible
      accessibilityRole={props.href === undefined ? "button" : "link"}
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: unavailable, busy: props.busy === true }}
      onAccessibilityTap={activate}
    >
      <Host
        matchContents={filling ? { vertical: true } : true}
        colorScheme={scheme}
        ignoreSafeArea="all"
      >
        <Button
          onPress={activate}
          modifiers={[
            accessibilityHidden(),
            buttonStyle(props.prominent ? "glassProminent" : "glass"),
            controlSize(filling ? "large" : "regular"),
            buttonBorderShape(iconOnly ? "circle" : "capsule"),
            tint(props.prominent ? palette.accentFill : palette.foreground),
            frame({ minWidth: controls.touchTarget, minHeight: height }),
            disabled(unavailable),
          ]}
        >
          <Label
            title={props.label}
            systemImage={props.systemImage}
            modifiers={[
              font({ textStyle: "body", weight: "medium" }),
              labelStyle(iconOnly ? "iconOnly" : props.systemImage ? "titleAndIcon" : "titleOnly"),
              ...(filling ? [frame({ maxWidth: Infinity })] : []),
            ]}
          />
        </Button>
      </Host>
    </View>
  );
}
