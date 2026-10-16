import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { controls, radii, spacing, tokens, useTheme } from "../theme.ts";

/**
 * The row along the composer card's bottom edge: the attachments toggle on the left and one primary
 * button on the right, which stops dictation while recording, sends once there is something to send,
 * and starts dictation otherwise.
 */
export function ComposerActions({
  attachOpen,
  attachDisabled,
  onToggleAttach,
  recording,
  onStopDictation,
  onDictate,
  hasContent,
  sendLabel,
  sending,
  busy,
  onSend,
}: {
  attachOpen: boolean;
  attachDisabled: boolean;
  onToggleAttach: () => void;
  recording: boolean;
  onStopDictation: () => void;
  onDictate: () => void;
  hasContent: boolean;
  sendLabel: string;
  sending: boolean;
  busy: boolean;
  onSend: () => void;
}) {
  const theme = useTheme();

  const triggerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(attachOpen ? 0 : 1),
    transform: [
      { scale: withTiming(attachOpen ? 1.6 : 1) },
      { translateX: withTiming(attachOpen ? 12 : 0) },
      { translateY: withTiming(attachOpen ? -12 : 0) },
    ],
  }));

  return (
    <View pointerEvents="box-none" style={field.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add attachment"
        accessibilityState={{ disabled: attachDisabled, expanded: attachOpen }}
        disabled={attachDisabled}
        onPress={onToggleAttach}
        style={[field.plusHit, attachDisabled && field.disabled]}
      >
        <Animated.View style={triggerStyle}>
          <SymbolView
            name="plus"
            size={controls.icon}
            tintColor={theme.foreground}
            weight="regular"
            style={{ transform: [{ translateY: 2 }] }}
          />
        </Animated.View>
      </Pressable>
      <View style={field.spacer} pointerEvents="none" />
      {recording ? (
        <html.button aria-label="Stop dictation" onClick={onStopDictation} style={styles.primary}>
          <SymbolView name="stop.circle.fill" size={28} tintColor={theme.accent} />
        </html.button>
      ) : hasContent ? (
        <html.button
          aria-label={sendLabel}
          aria-busy={sending}
          disabled={busy}
          onClick={onSend}
          style={styles.primary}
        >
          <html.div style={styles.send}>
            {sending ? (
              <ActivityIndicator color={theme.onPrimary} size="small" />
            ) : (
              <SymbolView name="arrow.up" size={19} tintColor={theme.onPrimary} weight="semibold" />
            )}
          </html.div>
        </html.button>
      ) : (
        <html.button
          aria-label="Dictate"
          disabled={busy}
          onClick={onDictate}
          style={styles.primary}
        >
          <html.div style={styles.microphone}>
            <SymbolView name="mic.fill" size={16} tintColor={theme.muted} />
          </html.div>
        </html.button>
      )}
    </View>
  );
}

const field = StyleSheet.create({
  plusHit: {
    width: controls.touchTarget,
    height: controls.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: 2,
    paddingBottom: 2,
    minHeight: controls.touchTarget + 2,
  },
  spacer: { flex: 1 },
  disabled: { opacity: controls.disabledOpacity },
});

const styles = css.create({
  primary: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    width: controls.touchTarget,
    height: controls.touchTarget,
    borderWidth: 0,
    padding: 0,
    opacity: {
      default: 1,
      ":active": controls.pressedOpacity,
      ":disabled": controls.disabledOpacity,
    },
  },
  send: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: tokens.primary,
  },
  microphone: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: controls.metaTarget,
    height: controls.metaTarget,
    borderRadius: radii.pill,
    backgroundColor: tokens.fill,
  },
});
