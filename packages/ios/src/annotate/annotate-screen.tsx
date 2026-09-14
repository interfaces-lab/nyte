import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  PanResponder,
  Pressable,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { Svg, Polyline } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { prepareImage } from "../media/attachments.ts";
import {
  clearAnnotation,
  readAnnotation,
  writeAnnotation,
  type AnnotationPoint,
} from "../media/annotations.ts";
import { controls, useTheme, radii, spacing, textStyles, typography } from "../theme.ts";

const MARK_COLOR = "#FF453A";
const TAP_TOLERANCE = 8;

type Stroke = { token: object; points: { x: number; y: number }[] };

type GestureState = {
  startX: number;
  startY: number;
  stroke: Stroke | undefined;
};

type ResponderDeps = {
  size: { width: number; height: number } | undefined;
  saving: boolean;
  points: readonly AnnotationPoint[];
  setStrokes: (update: (current: Stroke[]) => Stroke[]) => void;
  setPoints: (update: (current: AnnotationPoint[]) => AnnotationPoint[]) => void;
  setSelected: (n: number) => void;
  setComment: (comment: string) => void;
};

/**
 * Taps place numbered points; drags draw strokes. Coordinates are stored
 * relative (0–1) so marks survive canvas resizing. The in-flight drag lives in
 * the responder's own closure, outside render scope.
 */
function createAnnotateResponder(deps: ResponderDeps) {
  const { size, saving, points, setStrokes, setPoints, setSelected, setComment } = deps;
  let gesture: GestureState | null = null;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => !saving,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: (event) => {
      if (size === undefined) return;
      gesture = {
        startX: event.nativeEvent.locationX / size.width,
        startY: event.nativeEvent.locationY / size.height,
        stroke: undefined,
      };
    },
    onPanResponderMove: (event) => {
      if (gesture === null || size === undefined) return;
      const active = gesture;
      const x = event.nativeEvent.locationX / size.width;
      const y = event.nativeEvent.locationY / size.height;
      if (active.stroke === undefined) {
        const dx = (x - active.startX) * size.width;
        const dy = (y - active.startY) * size.height;
        if (Math.hypot(dx, dy) < TAP_TOLERANCE) return;
        active.stroke = { token: {}, points: [{ x: active.startX, y: active.startY }] };
      }
      const stroke = { ...active.stroke, points: [...active.stroke.points, { x, y }] };
      active.stroke = stroke;
      setStrokes((current) => [...current.filter((item) => item.token !== stroke.token), stroke]);
    },
    onPanResponderRelease: (event) => {
      const active = gesture;
      gesture = null;
      if (active === null || active.stroke !== undefined || size === undefined) return;
      const x = Math.min(1, Math.max(0, event.nativeEvent.locationX / size.width));
      const y = Math.min(1, Math.max(0, event.nativeEvent.locationY / size.height));
      const n = points.reduce((max, point) => Math.max(max, point.n), 0) + 1;
      setPoints((current) => [...current, { n, x, y, comment: "" }]);
      setSelected(n);
      setComment("");
    },
    onPanResponderTerminate: () => {
      gesture = null;
    },
  });
}

export function AnnotateScreen({ imageId, uri }: { imageId: string; uri: string }) {
  const theme = useTheme();

  const insets = useSafeAreaInsets();
  // Marks bake into the image on save, so re-editing starts from the flattened
  // capture with its point comments — earlier strokes are already drawn in.
  const [existing] = useState(() => readAnnotation(imageId));
  const baseUri = existing?.image.uri ?? uri;
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);
  const [points, setPoints] = useState<AnnotationPoint[]>(existing?.points ?? []);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const canvasRef = useRef<View>(null);

  const hasMarks = points.length > 0 || strokes.length > 0;
  const selectedPoint = points.find((point) => point.n === selected);

  // Rebuilt when the canvas size or point list changes so callbacks see fresh
  // values; the in-flight drag lives in the responder's own closure.
  const responder = useMemo(
    () =>
      createAnnotateResponder({
        size,
        saving,
        points,
        setStrokes,
        setPoints,
        setSelected,
        setComment,
      }),
    [size, saving, points],
  );

  function commitComment() {
    if (selected === undefined) return;
    setPoints((current) =>
      current.map((point) =>
        point.n === selected ? { ...point, comment: comment.trim() } : point,
      ),
    );
    setSelected(undefined);
    setComment("");
    Keyboard.dismiss();
  }

  async function done() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      if (!hasMarks) {
        clearAnnotation(imageId);
        router.back();
        return;
      }
      const captured = await captureRef(canvasRef, { format: "jpg", quality: 0.9 });
      const image = await prepareImage(captured);
      writeAnnotation(imageId, { image, points });
      router.back();
    } catch {
      setError("Couldn't save the markup. Try again.");
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <html.div
        data-layoutconformance="strict"
        style={[styles.topBar, styles.topInset(insets.top)]}
      >
        <GlassButton
          label="Cancel markup"
          systemImage="xmark"
          iconOnly
          scheme="dark"
          onPress={() => router.back()}
        />
        <html.span style={[textStyles.title, styles.titleDark]}>Markup</html.span>
        <html.div style={styles.topActions}>
          <GlassButton
            label="Clear marks"
            systemImage="trash"
            iconOnly
            scheme="dark"
            disabled={!hasMarks || saving}
            onPress={() => {
              setPoints([]);
              setStrokes([]);
              setSelected(undefined);
            }}
          />
          <GlassButton
            label={saving ? "Saving markup" : "Done"}
            disabled={saving}
            scheme="dark"
            prominent
            onPress={() => void done()}
          />
        </html.div>
      </html.div>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <View
          ref={canvasRef}
          collapsable={false}
          style={nativeStyles.canvas}
          onLayout={(event) =>
            setSize({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
          {...responder.panHandlers}
        >
          <Image source={{ uri: baseUri }} style={nativeStyles.canvasImage} resizeMode="contain" />
          {size !== undefined ? (
            <Svg style={StyleOverlay} pointerEvents="none">
              {strokes.map((stroke, index) => (
                <Polyline
                  key={index}
                  points={stroke.points
                    .map(
                      (point) => `${String(point.x * size.width)},${String(point.y * size.height)}`,
                    )
                    .join(" ")}
                  stroke={MARK_COLOR}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          ) : null}
          {size !== undefined
            ? points.map((point) => (
                <Pressable
                  key={point.n}
                  accessibilityLabel={`Point ${point.n}${point.comment === "" ? "" : `, ${point.comment}`}`}
                  onPress={() => {
                    setSelected(point.n);
                    setComment(point.comment);
                  }}
                  style={[
                    markerStyles.marker,
                    markerStyles.position(point.x * size.width, point.y * size.height),
                    selected === point.n && markerStyles.selected,
                  ]}
                >
                  <Text style={markerStyles.markerText}>{point.n}</Text>
                </Pressable>
              ))
            : null}
        </View>
      </View>
      <KeyboardStickyView>
        <html.div
          style={[styles.commentBar, styles.bottomInset(Math.max(insets.bottom, spacing.sm))]}
        >
          {error !== undefined ? (
            <html.p role="alert" style={textStyles.error}>
              {error}
            </html.p>
          ) : null}
          {selectedPoint !== undefined ? (
            <html.div style={styles.commentRow}>
              <View style={markerStyles.marker}>
                <Text style={markerStyles.markerText}>{selectedPoint.n}</Text>
              </View>
              <View style={nativeStyles.commentShell}>
                <TextInput
                  key={selectedPoint.n}
                  autoFocus
                  accessibilityLabel={`Comment for point ${selectedPoint.n}`}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="What should change here?"
                  placeholderTextColor="#8e8e93"
                  selectionColor="#0a84ff"
                  returnKeyType="done"
                  onSubmitEditing={commitComment}
                  style={{
                    color: "#000",
                    ...typography.title,
                    fontWeight: typography.body.fontWeight,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.lg,
                  }}
                />
              </View>
              <GlassButton
                label="Save comment"
                systemImage="checkmark"
                iconOnly
                scheme="dark"
                prominent
                onPress={commitComment}
              />
            </html.div>
          ) : (
            <html.div style={styles.commentRow}>
              <SymbolView name="hand.draw" size={controls.icon} tintColor={theme.muted} />
              <html.span style={[textStyles.secondary, styles.hint]}>
                Tap to mark a point, drag to draw.
              </html.span>
              {saving ? <ActivityIndicator color={theme.muted} /> : null}
            </html.div>
          )}
        </html.div>
      </KeyboardStickyView>
    </View>
  );
}

const StyleOverlay = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

const styles = css.create({
  topBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingInline: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: "transparent",
  },
  titleDark: { color: "#fff" },
  topInset: (top: number) => ({ paddingTop: top + spacing.sm }),
  topActions: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentBar: {
    paddingInline: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: "transparent",
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom }),
  commentRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
  },
  hint: { flexGrow: 1, flexShrink: 1 },
});

const nativeStyles = {
  canvas: {
    width: "92%",
    height: "80%",
    borderRadius: radii.control,
    overflow: "hidden",
    backgroundColor: "#111",
  } satisfies ViewStyle,
  canvasImage: { width: "100%", height: "100%" } satisfies ImageStyle,
  commentShell: {
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: "#fff",
    borderRadius: radii.bubble,
    overflow: "hidden",
  } satisfies ViewStyle,
};

const markerStyles = {
  marker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: MARK_COLOR,
    borderWidth: 1.5,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  } satisfies ViewStyle,
  markerText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  } satisfies TextStyle,
  position: (x: number, y: number): ViewStyle => ({
    position: "absolute",
    left: x - 11,
    top: y - 11,
  }),
  selected: {
    borderWidth: 2.5,
    borderColor: "#fff",
  } satisfies ViewStyle,
};
