// oxlint-disable-next-line no-restricted-imports -- camera permission follows its async resolution
import { useEffect, useState } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { LegendList } from "@legendapp/list/react-native";
import { OverKeyboardView } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { GlassView } from "expo-glass-effect";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { GlassSurface, HAS_GLASS } from "./composer-glass.tsx";
import { SPRING, ICON_ROW_INSET } from "./composer-geometry.ts";
import { prepareImage, type StagedImage } from "../media/attachments.ts";
import type { PhotoAccess, RecentPhoto } from "../media/recent-photos.ts";
import { overCamera, spacing, typography, useTheme } from "../theme.ts";

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

const MENU_ITEMS = [
  { label: "Camera", symbol: "camera", mode: "camera" },
  { label: "Photos", symbol: "photo", mode: "photos" },
] as const;

const CLOSED = 34;

const OPEN_WIDTH = 220;

const ITEM_ICON = 40;

const OPEN_PAD = spacing.lg;

const OPEN_GAP = spacing.md;

const OPEN_HEIGHT =
  OPEN_PAD * 2 + ITEM_ICON * MENU_ITEMS.length + OPEN_GAP * (MENU_ITEMS.length - 1);

type ExtendMode = (typeof MENU_ITEMS)[number]["mode"];

/**
 * Plus → glass menu → photo grid or live camera. Geometry is one continuous
 * blend of closed / open / extended, so closing from the grid shrinks straight
 * back to the plus.
 */
export function AttachmentsMenu({
  progress,
  extendProgress,
  keyboardHeight,
  cardDock,
  plusLeft,
  access,
  disabled,
  onClose,
  onPick,
  onManageAccess,
  onCapture,
}: {
  progress: SharedValue<number>;
  extendProgress: SharedValue<number>;
  keyboardHeight: SharedValue<number>;
  cardDock: SharedValue<number>;
  plusLeft: SharedValue<number>;
  access: PhotoAccess | undefined;
  disabled: boolean;
  onClose: () => void;
  onPick: (photo: RecentPhoto) => void;
  onManageAccess: () => void;
  onCapture: (image: StagedImage) => void;
}) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [extended, setExtended] = useState(false);
  const [mode, setMode] = useState<ExtendMode>("photos");
  const photos = access === undefined || access.kind === "denied" ? [] : [...access.photos];

  const expandTo = (next: ExtendMode) => {
    setMode(next);
    setExtended(true);
    extendProgress.set(withSpring(1, SPRING.open));
  };

  const collapseToMenu = () => {
    extendProgress.set(
      withSpring(0, SPRING.open, (finished) => {
        "worklet";

        if (finished) scheduleOnRN(setExtended, false);
      }),
    );
  };

  const bottom = useDerivedValue(() => {
    const x = extendProgress.get();
    const closed = cardDock.get() + ICON_ROW_INSET - CLOSED / 2;
    const next = 8;

    return closed + (next - closed) * x;
  });

  const left = useDerivedValue(() => {
    const x = extendProgress.get();
    const closed = plusLeft.get();
    const next = 8;

    return closed + (next - closed) * x;
  });

  const width = useDerivedValue(() => {
    const p = progress.get();
    const x = extendProgress.get();
    const next = screenWidth - 16;

    return CLOSED + (OPEN_WIDTH - CLOSED) * p + (next - OPEN_WIDTH) * x;
  });

  const height = useDerivedValue(() => {
    const p = progress.get();
    const x = extendProgress.get();
    const kb = keyboardHeight.get();
    const next = kb === 0 ? 440 : OPEN_HEIGHT - 108 - kb;

    return CLOSED + (OPEN_HEIGHT - CLOSED) * p + (next - OPEN_HEIGHT) * x;
  });

  const menuStyle = useAnimatedStyle(() => ({
    width: width.get(),
    height: height.get(),
    bottom: bottom.get(),
    left: left.get(),
    boxShadow: `${interpolate(progress.get(), [0, 1], [0, 0.2])}px ${interpolate(progress.get(), [0, 1], [0, 4])}px ${interpolate(progress.get(), [0, 1], [0, 24])}px rgba(0, 0, 0, ${interpolate(progress.get(), [0, 1], [0, 0.05])})`,
  }));

  const fallbackFill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.get(),
      [0, 0.3, 1],
      ["#00000000", "#00000000", theme.surface],
    ),
  }));

  const itemListOpacity = useDerivedValue(() => {
    const openFade = interpolate(progress.get(), [0, 0.3, 1], [0, 0, 1]);

    return Math.max(0, openFade - extendProgress.get());
  });

  // Scale from the plus's bottom-left: RN scales from the centre, so shift by
  // half the leftover size to keep that corner planted.
  const itemListStyle = useAnimatedStyle(() => {
    const s = interpolate(progress.get(), [0, 1], [0.7, 1]);
    const w = width.get();
    const h = height.get();

    return {
      opacity: itemListOpacity.get(),
      transform: [
        { translateX: -(w * (1 - s)) / 2 },
        { translateY: (h * (1 - s)) / 2 },
        { scale: s },
      ],
    };
  });

  const imageGridStyle = useAnimatedStyle(() => ({
    width: screenWidth - 16,
    height: height.get(),
  }));

  const gridFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(extendProgress.get(), [0, 0.4, 1], [0, 0, 1]),
  }));

  const gridButtonsStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(extendProgress.get(), [0, 0.6, 1], [20, 20, 0]) },
      { scale: interpolate(extendProgress.get(), [0, 0.6, 1], [0, 0, 1]) },
    ],
  }));

  const plusIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.3, 1], [1, 0, 0]),
  }));

  const glassProps = useAnimatedProps(() => ({
    glassEffectStyle: progress.get() > 0.01 ? ("clear" as const) : ("none" as const),
    tintColor: "#00000000",
  }));

  const chrome = HAS_GLASS ? overCamera.foreground : theme.foreground;

  const body = (
    <>
      <Animated.View style={[styles.plusIcon, plusIconStyle]} pointerEvents="none">
        <SymbolView name="plus" size={20} tintColor={theme.foreground} weight="regular" />
      </Animated.View>
      <Animated.View style={[styles.itemList, itemListStyle]}>
        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.label}
            accessibilityLabel={item.label}
            disabled={disabled}
            onPress={() => expandTo(item.mode)}
            style={styles.item}
          >
            <View style={[styles.itemIcon, { backgroundColor: theme.fill }]}>
              <SymbolView name={item.symbol} size={24} tintColor={theme.foreground} />
            </View>
            <Text style={[styles.itemLabel, { color: theme.foreground }]}>{item.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
      {extended ? (
        <Animated.View style={[styles.imageGrid, imageGridStyle]}>
          <Animated.View style={[styles.imageList, gridFadeStyle]}>
            {mode === "camera" ? (
              <AttachCamera
                disabled={disabled}
                extendProgress={extendProgress}
                onCapture={onCapture}
              />
            ) : (
              <LegendList
                style={styles.imageList}
                columnWrapperStyle={styles.gridGap}
                data={photos}
                keyExtractor={(item) => item.id}
                numColumns={3}
                estimatedItemSize={118}
                recycleItems
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityLabel="Attach photo"
                    disabled={disabled}
                    onPress={() => onPick(item)}
                    style={styles.imageCell}
                  >
                    <Image source={{ uri: item.uri }} style={styles.image} />
                  </Pressable>
                )}
              />
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );

  return (
    <OverKeyboardView visible>
      <GestureHandlerRootView style={styles.fullScreen}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.fullScreen} pointerEvents="box-none">
          {HAS_GLASS ? (
            <AnimatedGlassView
              isInteractive
              style={[styles.menu, menuStyle]}
              animatedProps={glassProps}
            >
              {body}
            </AnimatedGlassView>
          ) : (
            <Animated.View style={[styles.menu, menuStyle, fallbackFill]}>{body}</Animated.View>
          )}
          {extended ? (
            <>
              <Animated.View style={[styles.backButton, gridButtonsStyle]}>
                <Pressable accessibilityLabel="Back to attachment choices" onPress={collapseToMenu}>
                  <GlassSurface
                    isInteractive
                    glassEffectStyle="regular"
                    style={styles.backButtonGlass}
                  >
                    <SymbolView name="arrow.left" size={22} tintColor={chrome} weight="light" />
                  </GlassSurface>
                </Pressable>
              </Animated.View>
              {mode === "photos" ? (
                <Animated.View style={[styles.allPhotosButton, gridButtonsStyle]}>
                  <Pressable accessibilityLabel="Choose more photos" onPress={onManageAccess}>
                    <GlassSurface
                      isInteractive
                      glassEffectStyle="regular"
                      style={styles.allPhotosGlass}
                    >
                      <Text style={[styles.allPhotosLabel, { color: chrome }]}>All Photos</Text>
                    </GlassSurface>
                  </Pressable>
                </Animated.View>
              ) : null}
            </>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </OverKeyboardView>
  );
}

function AttachCamera({
  disabled,
  extendProgress,
  onCapture,
}: {
  disabled: boolean;
  extendProgress: SharedValue<number>;
  onCapture: (image: StagedImage) => void;
}) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const output = usePhotoOutput({ qualityPrioritization: "balanced" });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");

  const shutterStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(extendProgress.get(), [0, 0.6, 1], [20, 20, 0]) },
      { scale: interpolate(extendProgress.get(), [0, 0.6, 1], [0, 0, 1]) },
    ],
  }));

  // Permission status resolves asynchronously after mount; the request follows.
  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  useMountEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );

    return () => subscription.remove();
  });

  const capture = () => {
    if (disabled || !ready || busy || !active || !hasPermission || device === undefined) return;
    setBusy(true);
    void output
      .capturePhotoToFile({ flashMode: "off" }, {})
      .then((photo) => prepareImage(photo.filePath))
      .then(onCapture)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.imageList}>
      {hasPermission && device !== undefined ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[output]}
          isActive={active}
          onStarted={() => setReady(true)}
          onStopped={() => setReady(false)}
        />
      ) : (
        <View style={styles.cameraNotice} />
      )}
      <Animated.View style={[styles.captureButton, shutterStyle]} pointerEvents="box-none">
        <Pressable
          accessibilityLabel="Take photo"
          disabled={disabled || !ready || busy || !active || !hasPermission || device === undefined}
          onPress={capture}
          style={styles.captureOuter}
        >
          <View style={styles.captureInner} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  menu: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    borderCurve: "continuous",
    zIndex: 1,
  },
  plusIcon: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  itemList: {
    flex: 1,
    width: "100%",
    padding: OPEN_PAD,
    justifyContent: "center",
    gap: OPEN_GAP,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  itemIcon: {
    width: ITEM_ICON,
    height: ITEM_ICON,
    borderRadius: ITEM_ICON / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { fontSize: typography.body.fontSize },
  imageGrid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    borderBottomRightRadius: 28,
    borderBottomLeftRadius: 28,
    overflow: "hidden",
  },
  imageList: { flex: 1 },
  gridGap: { gap: 1 },
  imageCell: { flex: 1, aspectRatio: 1 },
  image: { flex: 1, backgroundColor: "rgba(120, 120, 128, 0.12)" },
  backButton: { position: "absolute", left: 28, bottom: 28, zIndex: 10 },
  backButtonGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  allPhotosButton: { position: "absolute", right: 28, bottom: 28, zIndex: 10 },
  allPhotosGlass: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  allPhotosLabel: { fontSize: 16, fontWeight: "600" },
  captureButton: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: "center",
    zIndex: 10,
  },
  captureOuter: {
    width: 56,
    height: 56,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
  },
  captureInner: {
    width: 44,
    height: 44,
    borderRadius: 27,
    backgroundColor: "#FFF",
  },
  cameraNotice: { flex: 1, backgroundColor: "#000" },
});
