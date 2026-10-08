import { useState } from "react";
import { ScrollView, View } from "react-native";
import { BottomSheet, RNHostView } from "@expo/ui";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  clamp,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { css, html } from "react-strict-dom";
import { controls, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { SELECTOR, SPRING } from "./composer-geometry.ts";
import { GaugeIcon } from "./gauge-icon.tsx";
import { THINKING_LABELS, type ThinkingLevel } from "./thinking.ts";

const KNOB_SIZE = controls.touchTarget;

const TRACK_START = SELECTOR.inset + KNOB_SIZE / 2;

export function ThinkingSelector({
  open,
  level,
  initialIndex,
  levels,
  modelName,
  onClose,
  onCommit,
}: {
  open: boolean;
  level: SharedValue<number>;
  initialIndex: number;
  levels: readonly ThinkingLevel[];
  modelName: string;
  onClose: () => void;
  onCommit: (index: number) => void;
}) {
  const theme = useTheme();
  const width = useSharedValue(0);
  const span = Math.max(levels.length - 1, 0);
  const [previewIndex, setPreviewIndex] = useState(initialIndex);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [previousIndex, setPreviousIndex] = useState(initialIndex);

  if (previousOpen !== open || previousIndex !== initialIndex) {
    setPreviousOpen(open);
    setPreviousIndex(initialIndex);
    setPreviewIndex(initialIndex);
  }

  const current = levels[previewIndex] ?? levels[0];
  const title = current === undefined ? "Thinking level" : THINKING_LABELS[current];

  useAnimatedReaction(
    () => Math.round(clamp(level.get(), 0, span)),
    (index, previous) => {
      if (index !== previous) scheduleOnRN(setPreviewIndex, index);
    },
  );

  const fillStyle = useAnimatedStyle(() => ({
    width:
      KNOB_SIZE +
      (span === 0 ? 0 : (Math.max(0, width.get() - TRACK_START * 2) * level.get()) / span),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          span === 0 ? 0 : (Math.max(0, width.get() - TRACK_START * 2) * level.get()) / span,
      },
    ],
  }));

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      const travel = Math.max(1, width.get() - TRACK_START * 2);
      const next = Math.round(clamp((event.x - TRACK_START) / travel, 0, 1) * span);
      level.set(withSpring(next, SPRING.knob));
    })
    .onUpdate((event) => {
      const travel = Math.max(1, width.get() - TRACK_START * 2);
      level.set(clamp((event.x - TRACK_START) / travel, 0, 1) * span);
    })
    .onFinalize(() => {
      const next = Math.round(clamp(level.get(), 0, span));
      level.set(withSpring(next, SPRING.knob));
      scheduleOnRN(onCommit, next);
    });

  const commit = (index: number) => {
    const next = Math.round(clamp(index, 0, span));
    level.set(next);
    setPreviewIndex(next);
    onCommit(next);
  };

  return (
    <BottomSheet
      isPresented={open}
      onDismiss={onClose}
      snapPoints={["half", "full"]}
      contentPadding={0}
      containerColor={theme.surface}
    >
      <RNHostView>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.surface }}>
          <html.div style={styles.header}>
            <html.h2 style={[textStyles.title, styles.heading]}>Thinking level</html.h2>
            <GlassButton
              label="Close thinking selector"
              systemImage="xmark"
              iconOnly
              onPress={onClose}
            />
          </html.div>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            <html.div style={styles.content}>
              <html.div style={styles.summary}>
                <html.span style={textStyles.secondary}>{modelName}</html.span>
                <html.span style={textStyles.heading}>{title}</html.span>
              </html.div>
              <GestureDetector gesture={pan}>
                <View
                  onLayout={(event) => width.set(event.nativeEvent.layout.width)}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Thinking level"
                  accessibilityValue={{ min: 0, max: span, now: previewIndex, text: title }}
                  accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                  onAccessibilityAction={({ nativeEvent }) => {
                    if (nativeEvent.actionName === "increment") commit(previewIndex + 1);

                    if (nativeEvent.actionName === "decrement") commit(previewIndex - 1);
                  }}
                  style={{
                    height: SELECTOR.trackHeight,
                    borderRadius: SELECTOR.trackHeight / 2,
                    backgroundColor: theme.raised,
                  }}
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute",
                        left: SELECTOR.inset,
                        top: (SELECTOR.trackHeight - KNOB_SIZE) / 2,
                        height: KNOB_SIZE,
                        borderRadius: KNOB_SIZE / 2,
                        backgroundColor: theme.accentFill,
                      },
                      fillStyle,
                    ]}
                  />
                  {levels.map((entry, index) => (
                    <Tick key={entry} index={index} span={span} width={width} level={level} />
                  ))}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute",
                        left: SELECTOR.inset,
                        top: (SELECTOR.trackHeight - KNOB_SIZE) / 2,
                        width: KNOB_SIZE,
                        height: KNOB_SIZE,
                        borderRadius: KNOB_SIZE / 2,
                        backgroundColor: theme.surface,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                      knobStyle,
                    ]}
                  >
                    <GaugeIcon
                      level={level}
                      stopCount={levels.length}
                      accent={theme.accent}
                      track={theme.muted}
                      needle={theme.foreground}
                    />
                  </Animated.View>
                </View>
              </GestureDetector>
            </html.div>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={{ paddingHorizontal: spacing.gutter, gap: spacing.xs }}
            >
              {levels.map((entry, index) => (
                <html.button
                  key={entry}
                  aria-pressed={index === previewIndex}
                  onClick={() => commit(index)}
                  style={[styles.level, index === previewIndex && styles.selected]}
                >
                  <html.span
                    style={[textStyles.secondary, index === previewIndex && styles.selectedText]}
                  >
                    {THINKING_LABELS[entry]}
                  </html.span>
                </html.button>
              ))}
            </ScrollView>
          </ScrollView>
        </GestureHandlerRootView>
      </RNHostView>
    </BottomSheet>
  );
}

function Tick({
  index,
  span,
  width,
  level,
}: {
  index: number;
  span: number;
  width: SharedValue<number>;
  level: SharedValue<number>;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => ({
    left:
      TRACK_START -
      SELECTOR.tickSize / 2 +
      (span === 0 ? 0 : (Math.max(0, width.get() - TRACK_START * 2) * index) / span),
    backgroundColor: level.get() >= index ? theme.onAccentFill : theme.muted,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: (SELECTOR.trackHeight - SELECTOR.tickSize) / 2,
          width: SELECTOR.tickSize,
          height: SELECTOR.tickSize,
          borderRadius: SELECTOR.tickSize / 2,
        },
        style,
      ]}
    />
  );
}

const styles = css.create({
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: { margin: 0, flex: 1 },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xl,
    paddingInline: spacing.gutter,
    paddingBottom: spacing.lg,
  },
  summary: { display: "flex", flexDirection: "column", gap: spacing.xs },
  level: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: controls.touchTarget,
    minHeight: controls.touchTarget,
    paddingInline: spacing.sm,
    paddingBlock: spacing.xs,
    flexShrink: 0,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radii.sm,
    backgroundColor: "transparent",
  },
  selected: { borderColor: tokens.accent, backgroundColor: tokens.selection },
  selectedText: { color: tokens.accent, fontWeight: 600 },
});
