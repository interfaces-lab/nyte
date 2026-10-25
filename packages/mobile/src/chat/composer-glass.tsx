import { forwardRef, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  useColorScheme,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassViewProps,
} from "expo-glass-effect";
import Animated from "react-native-reanimated";
import { controls, useTheme } from "../theme.ts";

/**
 * Before iOS 26, and on iOS 26 betas without `UIGlassEffect`, GlassView installs no effect and draws
 * nothing, so those devices get the blur fallback.
 */
const HAS_GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/** Reduce Transparency is one system setting, read once and followed for the app's life. */
const transparency = { reduced: false, listeners: new Set<() => void>() };

function followTransparency(reduced: boolean) {
  if (reduced === transparency.reduced) return;
  transparency.reduced = reduced;

  for (const listener of transparency.listeners) listener();
}

void AccessibilityInfo.isReduceTransparencyEnabled().then(followTransparency);
AccessibilityInfo.addEventListener("reduceTransparencyChanged", followTransparency);

function subscribeTransparency(listener: () => void) {
  transparency.listeners.add(listener);

  return () => {
    transparency.listeners.delete(listener);
  };
}

/**
 * Liquid Glass, else the system material blur, else a solid surface when Reduce Transparency is on.
 * Glass clips itself to its `borderRadius`: never set `overflow: "hidden"` on it or an ancestor, which
 * cuts off the rim highlight and the interactive bulge; clip the content inside instead. Do not
 * animate opacity on this view or an ancestor either: that suppresses the material (expo/expo#41024).
 * Keep `isInteractive` for surfaces that act as one control.
 */
export const GlassSurface = forwardRef<ViewInstance, GlassViewProps>(function GlassSurface(
  { style, isInteractive, glassEffectStyle, tintColor, colorScheme, children, ...rest },
  ref,
) {
  const theme = useTheme();
  const appearance = useColorScheme() === "dark" ? "dark" : "light";

  const reduced = useSyncExternalStore(subscribeTransparency, () => transparency.reduced);

  if (HAS_GLASS && !reduced) {
    return (
      <GlassView
        ref={ref}
        style={style}
        isInteractive={isInteractive}
        glassEffectStyle={glassEffectStyle ?? "regular"}
        tintColor={tintColor}
        colorScheme={colorScheme ?? appearance}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }

  const fallback: ViewStyle = {
    backgroundColor: reduced ? theme.surface : "transparent",
    borderWidth: controls.hairline,
    borderColor: theme.border,
    borderStyle: "solid",
    overflow: "hidden",
  };

  return (
    <View ref={ref} style={[fallback, style]} {...rest}>
      {reduced ? null : (
        <BlurView tint="systemMaterial" intensity={80} style={StyleSheet.absoluteFill} />
      )}
      {children}
    </View>
  );
});

export const AnimatedGlass = Animated.createAnimatedComponent(GlassSurface);
