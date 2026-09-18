import { forwardRef } from "react";
import { View, type ViewProps, type ViewStyle } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Animated from "react-native-reanimated";
import { controls, useTheme } from "../theme.ts";

/** False on iOS before 26, where GlassView is a stub with no fill of its own. */
export const HAS_GLASS = isLiquidGlassAvailable();

type GlassSurfaceProps = ViewProps & {
  isInteractive?: boolean;
  glassEffectStyle?: "regular" | "clear";
};

/**
 * Liquid Glass with a flat fallback. Do not animate opacity on this view or on
 * an ancestor: that suppresses the material (expo/expo#41024). Size is fine.
 */
export const GlassSurface = forwardRef<View, GlassSurfaceProps>(function GlassSurface(
  { style, isInteractive, glassEffectStyle, ...rest },
  ref,
) {
  const theme = useTheme();
  if (HAS_GLASS) {
    return (
      <GlassView
        ref={ref}
        style={style}
        isInteractive={isInteractive}
        glassEffectStyle={glassEffectStyle}
        {...rest}
      />
    );
  }
  const fallback: ViewStyle = {
    backgroundColor: theme.surface,
    borderWidth: controls.hairline,
    borderColor: theme.border,
    borderStyle: "solid",
  };
  return <View ref={ref} style={[fallback, style]} {...rest} />;
});

export const AnimatedGlass = Animated.createAnimatedComponent(GlassSurface);
