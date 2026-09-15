import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
} from "react-native-vision-camera";
import type { ScannedObject, ScannedObjectType } from "react-native-vision-camera";
import { css, html } from "react-strict-dom";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { media, overCamera, radii, spacing, textStyles } from "../theme.ts";
import { parseConnectionPayload, type Connection } from "./connection.ts";

// Hoisted: `useObjectOutput` memoizes on this array, so an inline literal would
// rebuild the camera output on every render.
const SCANNED_TYPES: ScannedObjectType[] = ["qr"];

/** A scanned code carries its decoded text; other object kinds do not. */
function decodedValue(object: ScannedObject): string | undefined {
  return "value" in object && typeof object.value === "string" ? object.value : undefined;
}

type ScanSheetProps = {
  visible: boolean;
  onClose: () => void;
  onScan: (connection: Connection) => void;
};

export function ScanSheet({ visible, onClose, onScan }: ScanSheetProps) {
  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="slide"
      onRequestClose={onClose}
    >
      {visible ? <ScanSession onClose={onClose} onScan={onScan} /> : null}
    </Modal>
  );
}

function ScanSession({ onClose, onScan }: Omit<ScanSheetProps, "visible">) {
  const insets = useSafeAreaInsets();
  const device = useCameraDevice("back");
  const { hasPermission, canRequestPermission } = useCameraPermission();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  // A code stays in frame for many callbacks. The ref latches before React
  // commits, so a second callback in the same frame cannot connect twice.
  const settled = useRef(false);
  const [found, setFound] = useState(false);
  const [error, setError] = useState<string>();

  const onObjectsScanned = useCallback(
    (objects: ScannedObject[]) => {
      if (settled.current) return;
      for (const object of objects) {
        const value = decodedValue(object);
        if (value === undefined) continue;
        try {
          const connection = parseConnectionPayload(value);
          settled.current = true;
          setFound(true);
          onScan(connection);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "That code isn't a Nyte connection.");
        }
        return;
      }
    },
    [onScan],
  );
  const output = useObjectOutput({ types: SCANNED_TYPES, onObjectsScanned });

  // The camera session is an external system: it follows the app's foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  const scanning = hasPermission && device !== undefined;
  return (
    <View style={{ flex: 1, backgroundColor: overCamera.backdrop }}>
      {scanning ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[output]}
          // The session stays mounted; only its activity follows the app.
          isActive={foreground && !found}
          onError={(cause) => setError(cause.message)}
        />
      ) : (
        <html.div style={styles.notice}>
          <EmptyState
            title={device === undefined ? "No camera on this device" : "Camera access needed"}
            description={
              device === undefined
                ? "Enter the address and token from your Mac instead."
                : canRequestPermission
                  ? "Allow camera access to scan the code on your Mac."
                  : "Allow access in Settings, or enter the details by hand."
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
      {scanning ? (
        <html.div style={styles.frame} aria-hidden>
          <html.div style={styles.reticle} />
        </html.div>
      ) : null}
      <html.div style={[styles.top, styles.topInset(insets.top)]}>
        <GlassButton
          label="Close scanner"
          systemImage="xmark"
          iconOnly
          scheme="dark"
          onPress={onClose}
        />
      </html.div>
      <html.div style={[styles.bottom, styles.bottomInset(insets.bottom)]}>
        {error === undefined ? (
          scanning ? (
            <html.p style={[textStyles.body, styles.hint]}>
              Point at the code in Nyte › Settings › Server on your Mac.
            </html.p>
          ) : null
        ) : (
          <html.p role="alert" style={[textStyles.error, styles.hint]}>
            {error}
          </html.p>
        )}
        <GlassButton label="Enter details instead" scheme="dark" onPress={onClose} />
      </html.div>
      {found ? <html.div style={styles.scrim} aria-hidden /> : null}
    </View>
  );
}

const styles = css.create({
  notice: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    justifyContent: "center",
    paddingInline: spacing.lg,
  },
  frame: {
    display: "flex",
    flexDirection: "column",
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: media.scanReticle,
    height: media.scanReticle,
    borderRadius: radii.sheet,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: overCamera.foreground,
  },
  top: { position: "absolute", insetInlineStart: spacing.lg },
  topInset: (top: number) => ({ top: top + spacing.md }),
  bottom: {
    display: "flex",
    flexDirection: "column",
    position: "absolute",
    insetInline: spacing.lg,
    gap: spacing.md,
    alignItems: "center",
  },
  bottomInset: (bottom: number) => ({ bottom: bottom + spacing.lg }),
  hint: { margin: 0, textAlign: "center", color: overCamera.foreground },
  scrim: { position: "absolute", inset: 0, backgroundColor: overCamera.scrim },
});
