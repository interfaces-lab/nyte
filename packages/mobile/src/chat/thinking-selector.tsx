import { useState } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import { StyleSheet, Text, useWindowDimensions, View, useColorScheme } from "react-native";
import { BlurView } from "expo-blur";
import { OverKeyboardView } from "react-native-keyboard-controller";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  clamp,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SELECTOR, SPRING, ICON_ROW_INSET } from "./composer-geometry.ts";
import { GaugeIcon } from "./gauge-icon.tsx";
import { THINKING_LABELS, type ThinkingLevel } from "./thinking.ts";

export type ThinkingSelectorColors = {
  text: string;
  accent: string;
  track: string;
  tickOnTrack: string;
  tickOnFill: string;
  knob: string;
  gaugeTrack: string;
  needle: string;
  scrim: string;
};

export function ThinkingSelector({
  progress,
  opening,
  level,
  gaugeCenterX,
  cardDock,
  levels,
  modelName,
  colors,
  onClose,
  onCommit,
}: {
  progress: SharedValue<number>;
  opening: SharedValue<boolean>;
  level: SharedValue<number>;
  gaugeCenterX: number;
  cardDock: SharedValue<number>;
  levels: readonly ThinkingLevel[];
  modelName: string;
  colors: ThinkingSelectorColors;
  onClose: () => void;
  onCommit: (index: number) => void;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const scheme = useColorScheme();
  // Mount owns the entrance: one frame for the closed position to exist, then
  // the spring to open. A close that beats the frame leaves `opening` false.
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (opening.get()) progress.set(withSpring(1, SPRING.open));
    });

    return () => cancelAnimationFrame(frame);
  });
  const span = Math.max(levels.length - 1, 0);
  const titles = levels.map((entry) => `${modelName} ${THINKING_LABELS[entry]}`);
  const [title, setTitle] = useState(() => titles[Math.round(level.get())] ?? "");
  // Prop changes (a new model's stops, a renamed model) adjust the label here;
  // mid-gesture changes never re-render and are published by the reaction below.
  const wanted = titles[Math.round(clamp(level.get(), 0, span))];

  if (wanted !== undefined && wanted !== title) setTitle(wanted);

  const openLeft = SELECTOR.trackInset;
  const openRight = screenWidth - SELECTOR.trackInset;
  const closedLeft = gaugeCenterX - SELECTOR.closedHeight / 2;
  const closedRight = gaugeCenterX + SELECTOR.closedHeight / 2;

  const trackLeft = useDerivedValue(() =>
    interpolate(progress.get(), [0, 1], [closedLeft, openLeft]),
  );

  const trackWidth = useDerivedValue(
    () => interpolate(progress.get(), [0, 1], [closedRight, openRight]) - trackLeft.get(),
  );

  const trackHeight = useDerivedValue(() =>
    interpolate(progress.get(), [0, 1], [SELECTOR.closedHeight, SELECTOR.trackHeight]),
  );

  const inset = useDerivedValue(() =>
    interpolate(progress.get(), [0, 1], [SELECTOR.closedInset, SELECTOR.inset]),
  );

  const fillHeight = useDerivedValue(() => trackHeight.get() - inset.get() * 2);
  const stop0 = useDerivedValue(() => inset.get() + fillHeight.get() / 2);
  const travel = useDerivedValue(() => trackWidth.get() - stop0.get() * 2);

  const knobX = useDerivedValue(() => {
    const t = span === 0 ? 0 : level.get() / span;

    return interpolate(
      progress.get(),
      [0, 1],
      [trackWidth.get() / 2, stop0.get() + travel.get() * t],
    );
  });

  const trackStyle = useAnimatedStyle(() => ({
    left: trackLeft.get(),
    width: trackWidth.get(),
    height: trackHeight.get(),
    borderRadius: trackHeight.get() / 2,
    // Icon-row centre, not the keyboard. This composer sits above extra padding.
    bottom: cardDock.get() + ICON_ROW_INSET - trackHeight.get() / 2,
    shadowOpacity: interpolate(progress.get(), [0, 1], [0, 0.1]),
  }));

  const clipStyle = useAnimatedStyle(() => ({ borderRadius: trackHeight.get() / 2 }));

  const fillStyle = useAnimatedStyle(() => ({
    left: inset.get(),
    height: fillHeight.get(),
    borderRadius: fillHeight.get() / 2,
    width: knobX.get() + fillHeight.get() / 2 - inset.get(),
  }));

  const knobStyle = useAnimatedStyle(() => {
    const ring = interpolate(progress.get(), [0, 1], [SELECTOR.closedRing, SELECTOR.knobRing]);
    const size = fillHeight.get() - ring * 2;

    return { left: knobX.get() - size / 2, width: size, height: size, borderRadius: size / 2 };
  });

  const gaugeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.1], [1, 0], Extrapolation.CLAMP),
  }));

  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [SELECTOR.handoff, SELECTOR.handoff * 4],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const ticksStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.25, 0.8], [0, 1], Extrapolation.CLAMP),
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  useAnimatedReaction(
    () => Math.round(clamp(level.get(), 0, span)),
    (index, previous) => {
      if (index === previous) return;
      const next = titles[index];

      if (next !== undefined) scheduleOnRN(setTitle, next);
    },
  );

  const labelStyle = useAnimatedStyle(() => {
    const p = progress.get();

    return {
      bottom: cardDock.get() + ICON_ROW_INSET + SELECTOR.trackHeight / 2 + SELECTOR.labelGap,
      opacity:
        interpolate(p, [0.2, 0.8], [0, 1], Extrapolation.CLAMP) *
        interpolate(p, [SELECTOR.handoff, SELECTOR.handoff * 4], [0, 1], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(p, [0, 1], [0.58, 1]) },
        { translateY: interpolate(p, [0, 1], [30, 0]) },
      ],
    };
  });

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      const t = clamp((event.x - stop0.get()) / travel.get(), 0, 1) * span;
      level.set(withSpring(Math.round(t), SPRING.knob));
    })
    .onUpdate((event) => {
      level.set(clamp((event.x - stop0.get()) / travel.get(), 0, 1) * span);
    })
    .onFinalize(() => {
      const snapped = Math.round(clamp(level.get(), 0, span));
      level.set(withSpring(snapped, SPRING.knob));
      scheduleOnRN(onCommit, snapped);
    });

  const backdrop = Gesture.Tap().onEnd(() => scheduleOnRN(onClose));

  return (
    <OverKeyboardView visible>
      <GestureHandlerRootView style={styles.fill}>
        <GestureDetector gesture={backdrop}>
          <Animated.View
            style={[StyleSheet.absoluteFill, scrimStyle, { backgroundColor: colors.scrim }]}
          />
        </GestureDetector>

        <Animated.View style={[styles.labelHost, labelStyle]} pointerEvents="none">
          <Text style={[styles.label, { color: colors.text }]}>{title}</Text>
        </Animated.View>

        <Animated.View style={[styles.track, trackStyle, rootStyle]}>
          <Animated.View style={[styles.trackClip, clipStyle]}>
            <BlurView
              style={StyleSheet.absoluteFill}
              intensity={22}
              tint={scheme === "dark" ? "dark" : "light"}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.track }]} />

            <Animated.View style={[styles.ticks, ticksStyle]} pointerEvents="none">
              <Ticks
                levels={levels}
                color={colors.tickOnTrack}
                stop0={stop0}
                travel={travel}
                span={span}
                offset={0}
              />
            </Animated.View>

            <Animated.View
              style={[styles.fillPill, fillStyle, { backgroundColor: colors.accent }]}
              pointerEvents="none"
            >
              <Animated.View style={[styles.ticks, ticksStyle]}>
                <Ticks
                  levels={levels}
                  color={colors.tickOnFill}
                  stop0={stop0}
                  travel={travel}
                  span={span}
                  offset={inset}
                />
              </Animated.View>
            </Animated.View>

            <Animated.View
              style={[styles.knob, knobStyle, { backgroundColor: colors.knob }]}
              pointerEvents="none"
            >
              <Animated.View style={gaugeStyle}>
                <GaugeIcon
                  level={level}
                  stopCount={levels.length}
                  accent={colors.accent}
                  track={colors.gaugeTrack}
                  needle={colors.needle}
                />
              </Animated.View>
            </Animated.View>
          </Animated.View>

          <GestureDetector gesture={pan}>
            <View style={StyleSheet.absoluteFill} />
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </OverKeyboardView>
  );
}

function Ticks({
  levels,
  color,
  stop0,
  travel,
  span,
  offset,
}: {
  levels: readonly ThinkingLevel[];
  color: string;
  stop0: SharedValue<number>;
  travel: SharedValue<number>;
  span: number;
  offset: SharedValue<number> | 0;
}) {
  return (
    <>
      {levels.map((entry, index) => (
        <Tick
          key={entry}
          index={index}
          color={color}
          stop0={stop0}
          travel={travel}
          span={span}
          offset={offset}
        />
      ))}
    </>
  );
}

function Tick({
  index,
  color,
  stop0,
  travel,
  span,
  offset,
}: {
  index: number;
  color: string;
  stop0: SharedValue<number>;
  travel: SharedValue<number>;
  span: number;
  offset: SharedValue<number> | 0;
}) {
  const style = useAnimatedStyle(() => {
    const shift = offset === 0 ? 0 : offset.get();
    const x = span === 0 ? stop0.get() : stop0.get() + (travel.get() * index) / span;

    return { left: x - shift - SELECTOR.tickSize / 2 };
  });

  return <Animated.View style={[styles.tick, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  track: {
    position: "absolute",
    justifyContent: "center",
    shadowColor: "#000",
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  trackClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    justifyContent: "center",
  },
  ticks: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    width: SELECTOR.tickSize,
    height: SELECTOR.tickSize,
    borderRadius: SELECTOR.tickSize / 2,
  },
  fillPill: {
    position: "absolute",
    overflow: "hidden",
  },
  knob: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  labelHost: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  label: {
    width: "100%",
    fontSize: SELECTOR.labelSize,
    lineHeight: SELECTOR.labelSize * 1.2,
    fontWeight: "600",
    textAlign: "center",
  },
});
