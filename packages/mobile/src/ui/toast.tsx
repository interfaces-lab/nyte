// oxlint-disable-next-line no-restricted-imports -- the exit animation keys on the leaving flag
import { useEffect, useSyncExternalStore } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import { AccessibilityInfo, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { controls, list, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";

type ToastKind = "default" | "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  leaving?: boolean;
}

const VISIBLE_LIMIT = 3;

const DURATION_MS = 4_000;

const ENTER_OFFSET = 20;

const EXIT_MS = 180;

const DISMISS_TRANSLATION = 40;

const DISMISS_VELOCITY = 400;

const icons: Record<
  Exclude<ToastKind, "default">,
  { name: SFSymbol; token: "success" | "danger" }
> = {
  success: { name: "checkmark.circle.fill", token: "success" },
  error: { name: "exclamationmark.triangle.fill", token: "danger" },
};

let items: ToastItem[] = [];

let counter = 0;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
}

function remove(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

function push(kind: ToastKind, title: string, body?: string) {
  items = [{ id: ++counter, kind, title, body }, ...items.filter((item) => !item.leaving)].slice(
    0,
    VISIBLE_LIMIT,
  );
  AccessibilityInfo.announceForAccessibility(body === undefined ? title : `${title}. ${body}`);
  emit();
}

/** Fire a transient banner from anywhere — no hook or context needed. */
export const toast = {
  show: (title: string, body?: string) => push("default", title, body),
  success: (title: string, body?: string) => push("success", title, body),
  error: (title: string, body?: string) => push("error", title, body),
};

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function ToastCard({ item }: { item: ToastItem }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  // Reduced motion swaps the slide for a fade; the enter still reads as an arrival.
  const offset = useSharedValue(reduceMotion ? 0 : ENTER_OFFSET);
  const opacity = useSharedValue(0);

  useMountEffect(() => {
    offset.set(withSpring(0, { damping: 24, stiffness: 260, mass: 0.9 }));
    opacity.set(withTiming(1, { duration: 160 }));
    const timer = setTimeout(() => dismiss(item.id), DURATION_MS);

    return () => clearTimeout(timer);
  });

  // The exit is an animated transition keyed on the leaving flag.
  useEffect(() => {
    if (item.leaving !== true) return;
    opacity.set(withTiming(0, { duration: EXIT_MS }));
    offset.set(
      withTiming(reduceMotion ? 0 : ENTER_OFFSET / 2, { duration: EXIT_MS }, () =>
        runOnJS(remove)(item.id),
      ),
    );
  }, [item.leaving, item.id, offset, opacity, reduceMotion]);

  const gesture = Gesture.Race(
    Gesture.Pan()
      .activeOffsetY([-8, 8])
      .onUpdate((event) => {
        // A finger-driven drag is direct manipulation, not an animated transition.
        offset.set(event.translationY > 0 ? event.translationY : event.translationY * 0.15);
      })
      .onEnd((event) => {
        if (event.translationY > DISMISS_TRANSLATION || event.velocityY > DISMISS_VELOCITY) {
          runOnJS(dismiss)(item.id);
        } else {
          offset.set(
            reduceMotion
              ? withTiming(0, { duration: 120 })
              : withSpring(0, { damping: 24, stiffness: 260, mass: 0.9 }),
          );
        }
      }),
    Gesture.Tap().onEnd(() => runOnJS(dismiss)(item.id)),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: offset.value }],
  }));

  const icon = item.kind === "default" ? undefined : icons[item.kind];

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>
        <html.div role="alert" style={styles.card}>
          {icon === undefined ? null : (
            <SymbolView
              name={icon.name}
              size={controls.icon}
              tintColor={theme[icon.token]}
              weight="semibold"
            />
          )}
          <html.div style={styles.text}>
            <html.span style={textStyles.label}>{item.title}</html.span>
            {item.body === undefined ? null : (
              <html.p style={[textStyles.caption, styles.body]}>{item.body}</html.p>
            )}
          </html.div>
        </html.div>
      </Animated.View>
    </GestureDetector>
  );
}

/** Mounts once under the root layout; renders above the composer. */
export function Toaster() {
  const insets = useSafeAreaInsets();
  const toasts = useSyncExternalStore(subscribe, () => items);

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[hostStyles.host, { bottom: insets.bottom + controls.composerBar + spacing.sm }]}
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </View>
  );
}

const hostStyles = {
  host: {
    position: "absolute",
    left: list.gutter,
    right: list.gutter,
    gap: spacing.xs,
    flexDirection: "column",
    zIndex: 10,
  },
} as const;

const styles = css.create({
  card: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingInline: spacing.lg,
    paddingBlock: spacing.md,
    minHeight: controls.touchTarget,
    borderRadius: radii.bubble,
    borderWidth: controls.hairline,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
    boxShadow: tokens.shadow,
  },
  text: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  // RSD's weak-type check rejects a style whose only prop is the non-CSS
  // lineClamp, so it rides with a real text prop.
  body: { lineClamp: 2, textAlign: "start" },
});
