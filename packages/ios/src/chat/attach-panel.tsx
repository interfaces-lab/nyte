/**
 * The attachment choices, opened from the composer's plus button. The panel
 * grows out of the capsule rather than pushing a screen, so the draft and the
 * keyboard stay where they are and the same button closes it.
 *
 * One spring drives the height, the lift, and the rows' entrance, so the panel
 * reads as the capsule expanding rather than as a sheet arriving. Reanimated
 * owns these styles, so they are plain objects rather than `css.create` rules.
 */
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";
import { Image, Pressable, ScrollView } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";
import { css, html } from "react-strict-dom";
import type { PhotoAccess, RecentPhoto } from "../media/recent-photos.ts";
import {
  controls,
  media,
  radii,
  spacing,
  surfaces,
  textStyles,
  tokens,
  useTheme,
} from "../theme.ts";

const ROW_HEIGHT = 48;
/** One row of recent photos: enough to pick from without covering the draft. */
const STRIP_HEIGHT = media.recentThumb + spacing.md * 2;
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
  const height = (photos.length === 0 ? 0 : STRIP_HEIGHT) + rows.length * ROW_HEIGHT;
  // Scale and lift from the plus button's corner, so the panel comes out of it.
  const panelStyle = useAnimatedStyle(() => ({
    height: progress.value * height,
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * spacing.md },
      { scale: 0.94 + 0.06 * progress.value },
    ],
  }));

  return (
    <Animated.View style={panelStyle} pointerEvents={open ? "auto" : "none"}>
      <html.div style={[surfaces.panel, styles.panel]}>
        {photos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ height: STRIP_HEIGHT }}
            contentContainerStyle={stripContent}
            keyboardShouldPersistTaps="always"
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
            divided={index > 0 || photos.length > 0}
            progress={progress}
            color={theme.foreground}
          />
        ))}
      </html.div>
    </Animated.View>
  );
}

function PanelRow({
  row,
  index,
  divided,
  progress,
  color,
}: {
  row: Row;
  index: number;
  divided: boolean;
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
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          opacity: pressed ? controls.pressedOpacity : 1,
        })}
      >
        {divided ? <html.div style={styles.divider} /> : null}
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

const stripContent = {
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  padding: spacing.md,
} as const;

const styles = css.create({
  panel: { display: "flex", flexDirection: "column" },
  label: { color: tokens.foreground },
  divider: {
    position: "absolute",
    top: 0,
    left: spacing.md,
    right: 0,
    height: controls.hairline,
    backgroundColor: tokens.separator,
  },
});
