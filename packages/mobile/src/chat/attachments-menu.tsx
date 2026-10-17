import { useRef, useState } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import {
  AppState,
  ActivityIndicator,
  AccessibilityInfo,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { getPermissionsAsync } from "expo-media-library";
import { OverKeyboardView } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { prepareImage, type StagedImage } from "../media/attachments.ts";
import type { PhotoAccess, RecentPhoto } from "../media/recent-photos.ts";
import { controls, menu, overCamera, spacing, typography, useTheme } from "../theme.ts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ATTACHMENT_MENU, useAttachmentMorph } from "./attachment-morph.ts";
import { AttachmentGlass, type AttachmentFlight } from "./attachment-flight.ts";
import { AttachmentPhotoGrid } from "./attachment-photo-grid.tsx";
import type { GlassViewProps } from "expo-glass-effect";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { GlassSurface } from "./composer-glass.tsx";

const MENU_ITEMS = [
  { label: "Camera", symbol: "camera", mode: "camera" },
  { label: "Photos", symbol: "photo", mode: "photos" },
] as const;

type ExtendMode = "camera" | "photos";

type PermissionHandoff =
  | { kind: "idle" }
  | { kind: "presenting" | "dismissing"; action: ExtendMode | "manage" };

/**
 * Plus → glass menu → photo grid or live camera. Geometry is one continuous
 * blend of closed / open / extended, so closing from the grid shrinks straight
 * back to the plus.
 */
export function AttachmentsMenu({
  progress,
  extendProgress,
  cardDock,
  plusLeft,
  access,
  disabled,
  onClose,
  onPreparePhotos,
  onCommitPhotos,
  remaining,
  flight,
  onRequestPhotos,
  onReadPhotos,
  onManageAccess,
  onCapture,
}: {
  progress: SharedValue<number>;
  extendProgress: SharedValue<number>;
  cardDock: SharedValue<number>;
  plusLeft: SharedValue<number>;
  access: PhotoAccess | undefined;
  disabled: boolean;
  onClose: () => void;
  onPreparePhotos: (photos: readonly RecentPhoto[]) => Promise<readonly StagedImage[]>;
  onCommitPhotos: (images: readonly StagedImage[]) => void;
  remaining: number;
  flight: AttachmentFlight;
  onRequestPhotos: () => Promise<void>;
  onReadPhotos: () => Promise<void>;
  onManageAccess: () => Promise<void>;
  onCapture: (image: StagedImage) => void;
}) {
  const theme = useTheme();
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions();
  const menuWidth = Math.min(screenWidth - spacing.sm * 2, menu.width * Math.max(1, fontScale));
  const rowHeight = Math.max(menu.rowHeight, typography.body.lineHeight * fontScale + menu.gap * 2);
  const menuHeight =
    menu.padding * 2 + rowHeight * MENU_ITEMS.length + menu.gap * (MENU_ITEMS.length - 1);
  const insets = useSafeAreaInsets();
  const [extended, setExtended] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<readonly RecentPhoto[]>([]);
  const [handoff, setHandoff] = useState<PermissionHandoff>({ kind: "idle" });
  const permissionRunning = useRef(false);
  const pendingPanel = useRef<ExtendMode | undefined>(undefined);
  const openingStarted = useRef(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useMountEffect(() => () => clearTimeout(collapseTimer.current));
  const [mode, setMode] = useState<ExtendMode>("photos");
  const [requesting, setRequesting] = useState<ExtendMode | "manage">();
  const [notice, setNotice] = useState<string>();
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const cameraDevice = useCameraDevice("back");

  const operationBusy =
    requesting !== undefined ||
    handoff.kind !== "idle" ||
    adding ||
    capturing ||
    flight.photo !== undefined;

  const blocked = disabled || operationBusy;

  const photos = access === undefined || access.kind === "denied" ? [] : [...access.photos];
  const availableIds = new Set(photos.map((photo) => photo.id));
  const sharedSelection = selectedPhotos.filter((photo) => availableIds.has(photo.id));

  const showPanel = (next: ExtendMode) => {
    clearTimeout(collapseTimer.current);
    setMode(next);
    setExtended(true);
    setPanelMounted(true);
    extendProgress.set(withSpring(1));
  };

  const expandTo = async (next: ExtendMode) => {
    if (blocked) return;
    setRequesting(next);
    setNotice(undefined);
    setSelectedPhotos([]);

    try {
      const granted =
        next === "photos" ? (await getPermissionsAsync(false, ["photo"])).granted : hasPermission;

      if (!granted && (next === "photos" || canRequestPermission)) {
        setHandoff({ kind: "presenting", action: next });

        return;
      }

      if (next === "photos") await onReadPhotos();
    } catch {
      setNotice(next === "photos" ? "Couldn't load photos" : "Couldn't open camera");
    }

    setRequesting(undefined);
    showPanel(next);
  };

  const manageAccess = () => {
    if (blocked) return;
    setRequesting("manage");
    setNotice(undefined);
    setHandoff({ kind: "presenting", action: "manage" });
  };

  const requestNativePermission = async () => {
    if (handoff.kind !== "presenting" || permissionRunning.current) return;
    permissionRunning.current = true;
    const action = handoff.action;

    try {
      if (action === "photos") await onRequestPhotos();
      else if (action === "camera") {
        if (canRequestPermission) await requestPermission();
      } else await onManageAccess();
    } catch {
      setNotice(action === "camera" ? "Couldn't open camera" : "Couldn't load photos");
    } finally {
      permissionRunning.current = false;
      setHandoff({ kind: "dismissing", action });
    }
  };

  const collapseToMenu = () => {
    setSelectedPhotos([]);
    setExtended(false);
    extendProgress.set(withSpring(0));
    collapseTimer.current = setTimeout(() => setPanelMounted(false), 450);
  };

  const addPhotos = async (selected: readonly RecentPhoto[]) => {
    if (blocked || selected.length === 0) return;
    setAdding(true);

    try {
      const prepared = await onPreparePhotos(
        selected.filter((photo) => availableIds.has(photo.id)),
      );

      const single = prepared.length === 1 ? prepared[0] : undefined;

      if (single !== undefined)
        flight.run(single, () => onCommitPhotos([single]), surfaceFrame.get());
      else if (prepared.length > 0) {
        onCommitPhotos(prepared);
        onClose();
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Couldn't attach photos");
    } finally {
      setAdding(false);
    }
  };

  const { containerStyle, menuStyle, panelStyle, height, radiusStyle, surfaceFrame } =
    useAttachmentMorph({
      progress,
      extend: extendProgress,
      cardDock,
      plusLeft,
      menuWidth,
      menuHeight,
      screenWidth,
      screenHeight,
      bottomInset: insets.bottom,
    });

  const imageGridStyle = useAnimatedStyle(() => ({
    width: screenWidth - 16,
    height: height.get(),
  }));

  const glassProps = useAnimatedProps<Pick<GlassViewProps, "glassEffectStyle" | "tintColor">>(
    () => ({
      glassEffectStyle: {
        style: progress.get() > 0.4 ? "regular" : "none",
        animate: true,
        animationDuration: 0.1,
      },
    }),
  );

  const chrome =
    mode === "camera" && hasPermission && cameraDevice !== undefined
      ? overCamera.foreground
      : theme.foreground;

  const body = (
    <>
      <Animated.View
        style={[styles.itemList, { width: menuWidth, height: menuHeight }, menuStyle]}
        pointerEvents={extended ? "none" : "auto"}
        accessibilityElementsHidden={extended}
        importantForAccessibility={extended ? "no-hide-descendants" : "auto"}
      >
        {MENU_ITEMS.map((item, index) => (
          <AttachmentMenuRow
            key={item.mode}
            index={index}
            item={item}
            progress={progress}
            height={rowHeight}
            disabled={blocked}
            busy={requesting === item.mode}
            onPress={() => void expandTo(item.mode)}
          />
        ))}
      </Animated.View>
      {panelMounted ? (
        <Animated.View
          pointerEvents={extended ? "auto" : "none"}
          style={[styles.imageGrid, imageGridStyle]}
        >
          <Animated.View style={[styles.imageList, panelStyle]}>
            {notice !== undefined ? (
              <EmptyState title={notice} />
            ) : mode === "camera" ? (
              <AttachCamera
                disabled={blocked}
                extendProgress={extendProgress}
                onCapture={onCapture}
                onBusyChange={setCapturing}
              />
            ) : access?.kind === "denied" ? (
              <EmptyState title="Photo access is off">
                <GlassButton
                  label="Open Settings"
                  onPress={() =>
                    void Linking.openSettings().catch(() => setNotice("Couldn't open Settings"))
                  }
                />
              </EmptyState>
            ) : photos.length === 0 ? (
              <EmptyState title="No shared photos" />
            ) : (
              <AttachmentPhotoGrid
                photos={photos}
                selected={sharedSelection}
                onToggle={(photo) =>
                  setSelectedPhotos((current) => {
                    const shared = current.filter((item) => availableIds.has(item.id));

                    return shared.some((item) => item.id === photo.id)
                      ? shared.filter((item) => item.id !== photo.id)
                      : shared.length >= remaining
                        ? shared
                        : [...shared, photo];
                  })
                }
                width={screenWidth - 16}
                remaining={remaining}
                busy={blocked}
                onAdd={addPhotos}
              />
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );

  return (
    <>
      <Modal
        visible={handoff.kind === "presenting"}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => {
          if (!operationBusy) onClose();
        }}
        onShow={() => void requestNativePermission()}
        onDismiss={() => {
          if (handoff.kind !== "dismissing") return;
          pendingPanel.current =
            handoff.action === "camera" || handoff.action === "photos" ? handoff.action : undefined;
          setRequesting(undefined);
          setHandoff({ kind: "idle" });
        }}
      >
        <View style={styles.fullScreen} />
      </Modal>
      <OverKeyboardView visible={handoff.kind === "idle"}>
        <GestureHandlerRootView
          style={styles.fullScreen}
          onLayout={() => {
            if (!openingStarted.current) {
              openingStarted.current = true;
              progress.set(withSpring(1));
            }

            const next = pendingPanel.current;

            if (next !== undefined) {
              pendingPanel.current = undefined;
              showPanel(next);
            }
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss attachment menu"
            disabled={operationBusy}
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          />
          <View style={styles.fullScreen} pointerEvents="box-none">
            <Animated.View
              style={[styles.menu, containerStyle, flight.surfaceHidden && { opacity: 0 }]}
            >
              <View style={{ flex: 1, width: "100%" }}>
                <AttachmentGlass
                  isInteractive
                  animatedProps={glassProps}
                  style={[StyleSheet.absoluteFill, radiusStyle]}
                >
                  {body}
                </AttachmentGlass>
              </View>
            </Animated.View>
            {panelMounted && !flight.surfaceHidden ? (
              <Animated.View
                pointerEvents={extended ? "box-none" : "none"}
                style={[styles.panelControls, panelStyle]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to attachment choices"
                  disabled={blocked}
                  onPress={collapseToMenu}
                >
                  <GlassSurface isInteractive style={styles.backButton}>
                    <SymbolView
                      name="chevron.left"
                      size={22}
                      tintColor={chrome}
                      weight="semibold"
                    />
                  </GlassSurface>
                </Pressable>
                {mode === "photos" && (access?.kind === "limited" || photos.length === 0) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Manage photo access"
                    disabled={blocked}
                    onPress={manageAccess}
                    style={styles.managePhotosButton}
                  >
                    <SymbolView name="ellipsis" size={22} tintColor={chrome} />
                  </Pressable>
                ) : null}
              </Animated.View>
            ) : null}
            {flight.photo === undefined ? null : (
              <Animated.View
                pointerEvents="none"
                style={[styles.photoOverlay, flight.overlayStyle]}
              >
                <Image
                  source={{ uri: flight.photo.uri }}
                  resizeMode="cover"
                  style={styles.overlayImage}
                />
              </Animated.View>
            )}
          </View>
        </GestureHandlerRootView>
      </OverKeyboardView>
    </>
  );
}

function AttachmentMenuRow({
  item,
  index,
  progress,
  height,
  disabled,
  busy,
  onPress,
}: {
  item: (typeof MENU_ITEMS)[number];
  index: number;
  progress: SharedValue<number>;
  height: number;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const start = 0.15 + index * 0.1;
  const end = start + 0.4;

  const rowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [start, end], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.get(), [start, end], [14, 0], Extrapolation.CLAMP) },
    ],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(progress.get(), [start, end], [0.5, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <Animated.View style={rowStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.item, { height }]}
      >
        <Animated.View style={[styles.itemIcon, { backgroundColor: theme.fill }, iconStyle]}>
          <SymbolView name={item.symbol} size={22} tintColor={theme.foreground} />
        </Animated.View>
        <Text style={[styles.itemLabel, { color: theme.foreground }]}>{item.label}</Text>
        {busy ? <ActivityIndicator color={theme.muted} /> : null}
      </Pressable>
    </Animated.View>
  );
}

function AttachCamera({
  disabled,
  extendProgress,
  onCapture,
  onBusyChange,
}: {
  disabled: boolean;
  extendProgress: SharedValue<number>;
  onCapture: (image: StagedImage) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const device = useCameraDevice("back");
  const { hasPermission } = useCameraPermission();
  const output = usePhotoOutput({ qualityPrioritization: "balanced" });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  const mounted = useRef(true);
  const capturePending = useRef(false);
  const [active, setActive] = useState(AppState.currentState === "active");

  const shutterStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(extendProgress.get(), [0, 0.6, 1], [20, 20, 0]) },
      { scale: interpolate(extendProgress.get(), [0, 0.6, 1], [0, 0, 1]) },
    ],
  }));

  useMountEffect(() => {
    mounted.current = true;

    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  });

  const capture = async () => {
    if (
      disabled ||
      !ready ||
      capturePending.current ||
      !active ||
      !hasPermission ||
      device === undefined
    )
      return;
    capturePending.current = true;
    setBusy(true);
    onBusyChange(true);
    setCaptureError(undefined);
    AccessibilityInfo.announceForAccessibility("Taking photo");

    try {
      const photo = await output.capturePhotoToFile({ flashMode: "off" }, {});

      if (!mounted.current) return;
      const image = await prepareImage(photo.filePath);

      if (mounted.current) onCapture(image);
    } catch {
      if (mounted.current) setCaptureError("Couldn't take photo. Try again.");
    } finally {
      capturePending.current = false;

      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
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
        <View style={[styles.cameraNotice, { backgroundColor: theme.surface }]}>
          <EmptyState title={hasPermission ? "Camera unavailable" : "Camera access is off"}>
            {hasPermission ? null : (
              <GlassButton
                label="Open Settings"
                onPress={() =>
                  void Linking.openSettings().catch(() =>
                    setCaptureError("Couldn't open Settings."),
                  )
                }
              />
            )}
          </EmptyState>
        </View>
      )}
      {captureError === undefined ? null : (
        <View style={[styles.cameraError, { backgroundColor: theme.surface }]}>
          <Text
            accessibilityRole="alert"
            style={{ color: theme.foreground, fontSize: typography.body.fontSize }}
          >
            {captureError}
          </Text>
          {hasPermission && device !== undefined ? (
            <GlassButton
              label="Try again"
              disabled={busy || !ready || !active}
              onPress={() => void capture()}
            />
          ) : null}
        </View>
      )}
      {hasPermission && device !== undefined ? (
        <Animated.View style={[styles.captureButton, shutterStyle]} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ busy }}
            disabled={disabled || !ready || !active || !hasPermission || device === undefined}
            onPress={() => void capture()}
            style={styles.captureOuter}
          >
            <View style={styles.captureInner} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  menu: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    zIndex: 1,
  },
  itemList: {
    position: "absolute",
    left: 0,
    bottom: 0,
    padding: menu.padding,
    gap: menu.gap,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: menu.gap,
  },
  itemIcon: {
    width: controls.touchTarget,
    height: controls.touchTarget,
    borderRadius: controls.touchTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { ...typography.body, flexShrink: 1 },
  imageGrid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: ATTACHMENT_MENU.expandedRadius,
    overflow: "hidden",
  },
  imageList: { flex: 1 },
  gridGap: { gap: 1 },
  imageCell: { flex: 1, aspectRatio: 1 },
  image: { flex: 1 },
  panelControls: {
    position: "absolute",
    left: ATTACHMENT_MENU.expandedMargin,
    right: ATTACHMENT_MENU.expandedMargin,
    bottom: ATTACHMENT_MENU.expandedMargin,
    paddingHorizontal: 17,
    height: 78,
    borderBottomLeftRadius: ATTACHMENT_MENU.expandedRadius,
    borderBottomRightRadius: ATTACHMENT_MENU.expandedRadius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 10,
  },
  backButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
  },
  managePhotosButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  photoOverlay: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#000000",
    zIndex: 20,
    boxShadow: "0 8px 16px rgba(0,0,0,0.2)",
  },
  overlayImage: { width: "100%", height: "100%" },
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
    borderColor: overCamera.foreground,
    justifyContent: "center",
    alignItems: "center",
  },
  captureInner: {
    width: 44,
    height: 44,
    borderRadius: 27,
    backgroundColor: overCamera.foreground,
  },
  cameraNotice: { flex: 1, backgroundColor: overCamera.backdrop },
  cameraError: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
});
