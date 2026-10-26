import { StaggeredText } from "./picker-animated-text.tsx";
import type { PressableProps } from "react-native";
import type { AnimationConfig } from "./picker-animated-text-types.ts";
import type { GlassViewProps } from "expo-glass-effect";
import { AnimatedGlass } from "./composer-glass.tsx";
import type React from "react";
import { useEffect, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

type IMorphButton = PressableProps & {
  bg: string;
  label?: string;
  textConfig?: Partial<AnimationConfig>;
};

const HPAD = 22;

const COLOR_TIMING = { duration: 420, easing: Easing.inOut(Easing.cubic) };

const WIDTH_TIMING = {};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const MorphButton: React.FC<IMorphButton> & React.FunctionComponent<IMorphButton> = ({
  bg,
  label,
  textConfig,
  style,
  ...rest
}: IMorphButton & React.ComponentProps<typeof MorphButton>): React.ReactNode &
  React.ReactElement &
  React.JSX.Element => {
  const progress = useSharedValue<number>(1);
  const from = useSharedValue<string>(bg);
  const to = useSharedValue<string>(bg);
  const isFirstColor = useRef<boolean>(true);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tweens from the on-screen color to the new background
  useEffect(() => {
    if (isFirstColor.current) {
      isFirstColor.current = false;

      return;
    }

    scheduleOnUI<[string], void>((next: string) => {
      "worklet";
      from.set(interpolateColor(progress.get(), [0, 1], [from.get(), to.get()]));
      to.set(next);
      progress.set(0);
      progress.set(withTiming(1, COLOR_TIMING));
    }, bg);
  }, [bg, from, to, progress]);

  const width = useSharedValue(0);
  const hasWidth = useRef(false);

  const onMeasure = (e: LayoutChangeEvent) => {
    const target = Math.ceil(e.nativeEvent.layout.width) + HPAD * 2;

    if (!hasWidth.current) {
      hasWidth.current = true;
      width.set(target);
    } else {
      width.set(withTiming(target, WIDTH_TIMING));
    }
  };

  const animatedStyle = useAnimatedStyle<Pick<ViewStyle, "width">>(() => ({
    width: width.get() === 0 ? undefined : width.get(),
  }));

  const animatedGlassViewPropz = useAnimatedProps<Pick<GlassViewProps, "tintColor">>(() => {
    return {
      tintColor: interpolateColor(progress.get(), [0, 1], [from.get(), to.get()]),
    };
  });

  return (
    <AnimatedPressable style={[style]} {...rest}>
      <AnimatedGlass
        style={[styles.button, animatedStyle]}
        glassEffectStyle="clear"
        isInteractive
        animatedProps={animatedGlassViewPropz}
      >
        <View style={styles.clip}>
          {!!label && (
            <StaggeredText
              text={label}
              style={styles.label}
              animationConfig={textConfig}
              enterFrom={{ translateY: 0, rotate: 0 }}
              exitTo={{ translateY: 0, rotate: 0 }}
            />
          )}
        </View>
      </AnimatedGlass>

      <View style={styles.measureContainer} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1} onLayout={onMeasure}>
          {label}
        </Text>
      </View>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  clip: { alignSelf: "stretch", alignItems: "center", overflow: "hidden" },
  label: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  measureContainer: {
    position: "absolute",
    top: -9999,
    left: 0,
    width: 2000,
    opacity: 0,
    alignItems: "flex-start",
  },
});

export { MorphButton };
