import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { SymbolView } from "expo-symbols";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { css, html } from "react-strict-dom";
import { AttachmentThumb } from "../media/attachment-thumb.tsx";
import type { StagedImage } from "../media/attachments.ts";
import type { AttachmentFlight } from "./attachment-flight.ts";
import { useMountEffect } from "../use-mount-effect.ts";

export function ComposerAttachment({
  image,
  index,
  flight,
  disabled,
  onAnnotate,
  onRemove,
}: {
  image: StagedImage;
  index: number;
  flight: AttachmentFlight;
  disabled: boolean;
  onAnnotate: () => void;
  onRemove: () => void;
}) {
  const [landing] = useState(flight.pendingId === image.id);
  const enter = useSharedValue(landing ? 1 : 0);
  const collapse = useSharedValue(1);
  const reveal = useSharedValue(landing ? 0 : 1);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const removing = useRef(false);

  useEffect(() => {
    if (!landing) enter.set(withSpring(1, { damping: 16, stiffness: 140, mass: 0.7 }));
  }, [enter, landing]);
  useEffect(() => {
    if (landing && flight.revealedId === image.id) reveal.set(1);
  }, [flight.revealedId, image.id, landing, reveal]);
  useMountEffect(() => () => clearTimeout(timer.current));

  const style = useAnimatedStyle(() => ({
    width: 68 * collapse.get(),
    marginRight: -10 * (1 - collapse.get()),
    opacity: reveal.get() * enter.get() * collapse.get(),
    transform: [{ scale: (0.7 + 0.3 * enter.get()) * (0.6 + 0.4 * collapse.get()) }],
  }));

  return (
    <Animated.View
      style={[{ height: 68 }, style]}
      onLayout={({ nativeEvent }) => {
        if (landing) flight.reportFrame(image.id, nativeEvent.layout);
      }}
    >
      <View style={{ width: "100%", height: "100%" }}>
        <html.button
          aria-label={`Annotate photo ${index + 1}`}
          disabled={disabled}
          onClick={onAnnotate}
          style={styles.imageButton}
        >
          <AttachmentThumb image={image} alt={`Attached photo ${index + 1}`} style={styles.image} />
        </html.button>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove photo ${index + 1}`}
          disabled={disabled}
          hitSlop={11}
          onPress={() => {
            if (removing.current) return;
            removing.current = true;
            collapse.set(withTiming(0, { duration: 240, easing: Easing.inOut(Easing.cubic) }));
            timer.current = setTimeout(onRemove, 240);
          }}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: "rgba(0,0,0,0.65)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SymbolView name="xmark" size={11} tintColor="#FFFFFF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = css.create({
  imageButton: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
    padding: 0,
    backgroundColor: "transparent",
  },
  image: { width: "100%", height: "100%", borderRadius: 14, objectFit: "cover" },
});
