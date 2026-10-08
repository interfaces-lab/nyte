import { forwardRef } from "react";
import { View, useColorScheme, type ViewStyle } from "react-native";
import { GlassView, isLiquidGlassAvailable, type GlassViewProps } from "expo-glass-effect";
import Animated from "react-native-reanimated";
import { controls, useTheme } from "../theme.ts";

/** False on iOS before 26, where GlassView is a stub with no fill of its own. */
export const HAS_GLASS = isLiquidGlassAvailable();

type GlassSurfaceProps = GlassViewProps;

/**
 * Liquid Glass with a flat fallback. Do not animate opacity on this view or on
 * an ancestor: that suppresses the material (expo/expo#41024). Size is fine.
 */
export const GlassSurface = forwardRef<View, GlassSurfaceProps>(function GlassSurface(
  { style, isInteractive, glassEffectStyle, tintColor, colorScheme, ...rest },
  ref,
) {
  const theme = useTheme();
  const appearance = useColorScheme() === "dark" ? "dark" : "light";

  if (HAS_GLASS) {
    return (
      <GlassView
        ref={ref}
        style={style}
        isInteractive={isInteractive}
        glassEffectStyle={glassEffectStyle ?? "regular"}
        tintColor={tintColor}
        colorScheme={colorScheme ?? appearance}
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
