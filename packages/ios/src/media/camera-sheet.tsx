import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { css, html } from "react-strict-dom";
import { prepareImage, type StagedImage } from "./attachments.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { useTheme, spacing, textStyles, tokens } from "../theme.ts";

type CameraSheetProps = {
  visible: boolean;
  onClose: () => void;
  onCapture: (image: StagedImage) => void;
};

export function CameraSheet({ visible, onClose, onCapture }: CameraSheetProps) {
  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="slide"
      onRequestClose={onClose}
    >
      {visible ? <CameraSession onClose={onClose} onCapture={onCapture} /> : null}
    </Modal>
  );
}

function CameraSession({ onClose, onCapture }: Omit<CameraSheetProps, "visible">) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [position, setPosition] = useState<"back" | "front">("back");
  const device = useCameraDevice(position);
  const alternateDevice = useCameraDevice(position === "back" ? "front" : "back");
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const output = usePhotoOutput({ qualityPrioritization: "balanced" });
  const [active, setActive] = useState(AppState.currentState === "active");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const captureInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (canRequestPermission && device !== undefined) {
      void requestPermission().catch(() => setError("Couldn't request camera access."));
    }
  }, [canRequestPermission, requestPermission, device]);

  async function capture() {
    if (!ready || busy || captureInFlight.current || !active) return;
    captureInFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const photo = await output.capturePhotoToFile({ flashMode: "off" }, {});
      const image = await prepareImage(photo.filePath);
      if (mounted.current) {
        onCapture(image);
        onClose();
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Couldn't take the photo. Try again.");
    } finally {
      captureInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {hasPermission && device !== undefined ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[output]}
          isActive={active}
          onStarted={() => setReady(true)}
          onStopped={() => setReady(false)}
          onError={(cause) => {
            setReady(false);
            setError(cause.message);
          }}
        />
      ) : (
        <html.div style={styles.notice}>
          <EmptyState
            title={device === undefined ? "Camera unavailable" : "Camera access needed"}
            description={
              device === undefined
                ? "Use Photo Library to attach an image."
                : canRequestPermission
                  ? "Allow camera access to take a photo."
                  : "Allow access in Settings to take a photo."
            }
          >
            {device !== undefined && !hasPermission && !canRequestPermission ? (
              <GlassButton
                label="Open Settings"
                onPress={() => {
                  void Linking.openSettings().catch(() => setError("Couldn't open Settings."));
                }}
              />
            ) : null}
          </EmptyState>
        </html.div>
      )}
      <html.div style={[styles.actions, styles.inset(insets.top)]}>
        <GlassButton
          label="Close camera"
          systemImage="xmark"
          iconOnly
          scheme="dark"
          onPress={onClose}
        />
      </html.div>
      <html.div style={[styles.bottom, styles.bottomInset(insets.bottom)]}>
        {error === undefined ? null : (
          <html.p role="alert" style={[textStyles.error, styles.error]}>
            {error}
          </html.p>
        )}
        <html.div style={styles.buttons}>
          <html.button
            aria-label="Take photo"
            disabled={!ready || !active || !hasPermission || device === undefined || busy}
            onClick={() => {
              void capture();
            }}
            style={styles.shutter}
          >
            {busy ? <ActivityIndicator color="#1c1c1e" /> : <html.div style={styles.shutterFill} />}
          </html.button>
          <html.div style={styles.flip}>
            <GlassButton
              label="Switch camera"
              systemImage="arrow.triangle.2.circlepath.camera"
              iconOnly
              scheme="dark"
              disabled={busy || alternateDevice === undefined}
              onPress={() => {
                setReady(false);
                setPosition((current) => (current === "back" ? "front" : "back"));
              }}
            />
          </html.div>
        </html.div>
      </html.div>
    </View>
  );
}

const styles = css.create({
  notice: {
    flexGrow: 1,
    justifyContent: "center",
    paddingInline: spacing.lg,
  },
  actions: { position: "absolute", insetInlineStart: spacing.lg },
  inset: (top: number) => ({ top: top + spacing.md }),
  bottom: { position: "absolute", insetInline: spacing.lg, gap: spacing.md, alignItems: "center" },
  bottomInset: (bottom: number) => ({ bottom: bottom + spacing.lg }),
  buttons: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: "#fff",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    opacity: { default: 1, ":active": 0.7, ":disabled": 0.4 },
  },
  shutterFill: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#C4C4C4" },
  flip: { position: "absolute", insetInlineEnd: 0 },
  error: { padding: spacing.md, backgroundColor: tokens.background },
});
