// oxlint-disable-next-line no-restricted-imports -- the pulse loop follows the reduced-motion setting
import { useEffect } from "react";
import { View } from "react-native";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { controls, list, radii, spacing, useTheme } from "../theme.ts";

const PULSE_LOW = 0.4;

const PULSE_HIGH = 0.85;

const PULSE_MS = 850;

/** Placeholder block pulsing over the fill tint, like UIKit skeletons. */
export function Skeleton({
  width,
  height,
  radius = radii.sm,
  style,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(reduceMotion ? 0.6 : PULSE_LOW);
  // The pulse loop follows the reduced-motion setting, which can change while mounted.
  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(
      withRepeat(
        withTiming(PULSE_HIGH, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );

    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.fill },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Mirrors SessionRow: status dot, title bar, meta bar, hairline under the text. */
export function SessionRowsSkeleton({ rows = 7 }: { rows?: number }) {
  const theme = useTheme();

  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={rowStyles.row}>
          <View style={rowStyles.leading}>
            <Skeleton width={controls.statusDot} height={controls.statusDot} radius={radii.pill} />
          </View>
          <View
            style={[
              rowStyles.text,
              index < rows - 1 && {
                borderBottomWidth: controls.hairline,
                borderBottomColor: theme.separator,
              },
            ]}
          >
            <Skeleton width={`${62 - index * 6}%`} height={12} />
            <Skeleton width="42%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const rowStyles = {
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingInlineStart: list.gutter,
  },
  leading: {
    width: list.leading,
    height: 22,
    marginTop: list.rowPaddingBlock,
    marginRight: list.leadingGap,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flexGrow: 1,
    gap: list.titleMetaGap + 3,
    paddingBlock: list.rowPaddingBlock,
    paddingRight: list.gutter,
  },
} as const;

/** Stands in for a transcript being read: a user bubble plus assistant lines. */
export function TranscriptSkeleton() {
  return (
    <View style={transcriptStyles.root}>
      <View style={transcriptStyles.bubbleWrap}>
        <Skeleton width="58%" height={46} radius={radii.bubble} />
      </View>
      <Skeleton width="82%" height={12} />
      <Skeleton width="74%" height={12} />
      <Skeleton width="45%" height={12} />
    </View>
  );
}

const transcriptStyles = {
  root: {
    flexDirection: "column",
    gap: spacing.md,
    padding: spacing.gutter,
    width: "100%",
  },
  bubbleWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingBlock: spacing.lg,
  },
} as const;
