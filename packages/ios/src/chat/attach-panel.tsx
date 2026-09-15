/**
 * The attachment choices, opened from the composer's plus button. They grow
 * above the capsule instead of pushing a screen, so the draft and the keyboard
 * stay where they are and the same button closes them.
 *
 * One spring drives the height and the rows' entrance. Reanimated owns these
 * styles, so they are plain objects rather than `css.create` rules.
 */
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";
import { Image, Pressable, ScrollView } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";
import { css, html } from "react-strict-dom";
import type { PhotoAccess, RecentPhoto } from "../media/recent-photos.ts";
import { controls, media, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";

const ROW_HEIGHT = 48;
const GRID_HEIGHT = media.recentThumb * 2 + spacing.sm * 3;
const SPRING = { duration: 280, dampingRatio: 1 } as const;

type Row = { id: string; label: string; icon: SFSymbol; run: () => void };

export function AttachPanel({
  open,
  disabled,
  access,
  onTakePhoto,
  onManageAccess,
  onPick,
}: {
  open: boolean;
  disabled: boolean;
  access: PhotoAccess | undefined;
  onTakePhoto: () => void;
  onManageAccess: () => void;
  onPick: (photo: RecentPhoto) => void;
}) {
  const theme = useTheme();
  const photos = access === undefined || access.kind === "denied" ? [] : access.photos;
  const rows: Row[] = [{ id: "camera", label: "Take photo", icon: "camera", run: onTakePhoto }];
  if (access?.kind === "limited")
    rows.push({
      id: "access",
      label: "Choose more photos",
      icon: "photo.badge.plus",
      run: onManageAccess,
    });
  if (access?.kind === "denied")
    rows.push({
      id: "access",
      label: "Allow photo access",
      icon: "lock",
      run: onManageAccess,
    });

  const progress = useDerivedValue(() => withSpring(open ? 1 : 0, SPRING));
  const height = (photos.length === 0 ? 0 : GRID_HEIGHT) + rows.length * ROW_HEIGHT;
  const panelStyle = useAnimatedStyle(() => ({
    height: progress.value * height,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[{ overflow: "hidden" }, panelStyle]}
      pointerEvents={open ? "auto" : "none"}
    >
      {photos.length > 0 ? (
        <ScrollView
          style={{ height: GRID_HEIGHT }}
          contentContainerStyle={gridContent}
          keyboardShouldPersistTaps="handled"
        >
          {photos.map((photo) => (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel="Attach photo"
              disabled={disabled}
              onPress={() => onPick(photo)}
              style={({ pressed }) => ({ opacity: pressed ? controls.pressedOpacity : 1 })}
            >
              <Image source={{ uri: photo.uri }} style={thumb} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {rows.map((row, index) => (
        <PanelRow
          key={row.id}
          row={row}
          index={index}
          progress={progress}
          color={theme.foreground}
        />
      ))}
    </Animated.View>
  );
}

function PanelRow({
  row,
  index,
  progress,
  color,
}: {
  row: Row;
  index: number;
  progress: { value: number };
  color: string;
}) {
  const rowStyle = useAnimatedStyle(() => {
    const start = index * 0.12;
    const local = Math.min(Math.max((progress.value - start) / (1 - start), 0), 1);
    return { opacity: local, transform: [{ translateY: (1 - local) * 8 }] };
  });

  return (
    <Animated.View style={rowStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.label}
        onPress={row.run}
        style={({ pressed }) => ({
          height: ROW_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.xs,
          opacity: pressed ? controls.pressedOpacity : 1,
        })}
      >
        <SymbolView name={row.icon} size={controls.icon} tintColor={color} />
        <html.span style={[textStyles.body, styles.label]}>{row.label}</html.span>
      </Pressable>
    </Animated.View>
  );
}

const thumb = {
  width: media.recentThumb,
  height: media.recentThumb,
  borderRadius: radii.control,
} as const;

const gridContent = {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.sm,
  paddingBottom: spacing.sm,
} as const;

const styles = css.create({
  label: { color: tokens.foreground },
});
