import { memo, useEffect, useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { RecentPhoto } from "../media/recent-photos.ts";
import { MorphButton } from "./picker-morph-button.tsx";

const PhotoCell = memo(function PhotoCell({
  photo,
  size,
  selected,
  order,
  disabled,
  onToggle,
}: {
  photo: RecentPhoto;
  size: number;
  selected: boolean;
  order: number;
  disabled: boolean;
  onToggle: (photo: RecentPhoto) => void;
}) {
  const press = useSharedValue(1);
  const selection = useSharedValue(selected ? 1 : 0);
  const previous = useRef(photo.id);
  useEffect(() => {
    if (previous.current !== photo.id) {
      previous.current = photo.id;
      selection.set(selected ? 1 : 0);
    } else selection.set(withTiming(selected ? 1 : 0, { duration: 190 }));
  }, [photo.id, selected, selection]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.get() * interpolate(selection.get(), [0, 1], [1, 0.86]) }],
    borderRadius: interpolate(selection.get(), [0, 1], [0, 12]),
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selection.get(), [0, 0.4, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(selection.get(), [0, 1], [0.4, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Select photo"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => onToggle(photo)}
      onPressIn={() => press.set(withTiming(0.9, { duration: 120 }))}
      onPressOut={() => press.set(withTiming(1, { duration: 160 }))}
      style={{ width: size, height: size }}
    >
      <Animated.View style={[{ width: "100%", height: "100%", overflow: "hidden" }, imageStyle]}>
        <Image
          source={{ uri: photo.uri }}
          resizeMode="cover"
          style={{ width: "100%", height: "100%" }}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 8,
            right: 8,
            minWidth: 24,
            height: 24,
            paddingHorizontal: 6,
            borderRadius: 12,
            backgroundColor: "#0A84FF",
            borderWidth: 2,
            borderColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          },
          badgeStyle,
        ]}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "700" }}>{order}</Text>
      </Animated.View>
    </Pressable>
  );
});

export function AttachmentPhotoGrid({
  photos,
  selected,
  onToggle,
  width,
  remaining,
  busy,
  onAdd,
}: {
  photos: readonly RecentPhoto[];
  selected: readonly RecentPhoto[];
  onToggle: (photo: RecentPhoto) => void;
  width: number;
  remaining: number;
  busy: boolean;
  onAdd: (photos: readonly RecentPhoto[]) => Promise<void>;
}) {
  const order = new Map(selected.map((photo, index) => [photo.id, index + 1]));
  const cellSize = (width - 0.3 * 2) / 3;

  const label =
    selected.length === 0
      ? "Select"
      : `Add ${selected.length} photo${selected.length === 1 ? "" : "s"}`;

  return (
    <View style={{ flex: 1 }}>
      <LegendList
        data={photos}
        extraData={order}
        keyExtractor={(photo) => photo.id}
        numColumns={3}
        estimatedItemSize={cellSize + 0.3}
        recycleItems
        drawDistance={600}
        columnWrapperStyle={{ gap: 0.3 }}
        contentContainerStyle={{ gap: 0.3, paddingBottom: 78 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <PhotoCell
            photo={item}
            size={cellSize}
            selected={order.has(item.id)}
            order={order.get(item.id) ?? 0}
            disabled={busy || (!order.has(item.id) && selected.length >= remaining)}
            onToggle={onToggle}
          />
        )}
      />
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 78,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingHorizontal: 17,
        }}
      >
        <MorphButton
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy, disabled: busy || selected.length === 0 }}
          bg={selected.length === 0 ? "#292929eb" : "#0a84fdce"}
          label={label}
          disabled={busy || selected.length === 0}
          onPress={() => void onAdd(selected)}
          style={{ minWidth: 46, height: 46, borderRadius: 23 }}
        />
      </View>
    </View>
  );
}
