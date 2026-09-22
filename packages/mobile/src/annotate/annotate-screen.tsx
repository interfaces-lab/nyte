import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import {
  controls,
  overCamera,
  themes,
  useTheme,
  radii,
  spacing,
  textStyles,
  typography,
} from "../theme.ts";

const MARK_COLOR = "#FF453A";

const TAP_TOLERANCE = 8;

type Spot = { x: number; y: number };

/**
 * Everything the user drew, newest last. One list keeps points and strokes in
 * the order they were made, so undo is a pop and the comment lives on the point
 * it belongs to.
 */
type Mark = { kind: "point"; point: AnnotationPoint } | { kind: "stroke"; points: readonly Spot[] };

type Canvas = { width: number; height: number };

type ResponderDeps = {
  size: Canvas | undefined;
  saving: boolean;
  nextNumber: number;
  addMark: (mark: Mark) => void;
  setDrawing: (points: readonly Spot[] | undefined) => void;
  setSelected: (n: number) => void;
};

/** Touch position as a fraction of the canvas, so marks survive resizing. */
function spotOf(x: number, y: number, size: Canvas): Spot {
  return {
    x: Math.min(1, Math.max(0, x / size.width)),
    y: Math.min(1, Math.max(0, y / size.height)),
  };
}

/**
 * Taps place numbered points; drags draw strokes. The in-flight drag lives in
 * the responder's own closure and reaches the canvas as `drawing` until release
 * commits it as a mark.
 */
function createAnnotateResponder(deps: ResponderDeps) {
  const { size, saving, nextNumber, addMark, setDrawing, setSelected } = deps;
  let start: Spot | null = null;
  let stroke: readonly Spot[] | null = null;

  return PanResponder.create({
    onStartShouldSetPanResponder: () => !saving,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: (event) => {
      if (size === undefined) return;
      start = spotOf(event.nativeEvent.locationX, event.nativeEvent.locationY, size);
      stroke = null;
    },
    onPanResponderMove: (event) => {
      if (start === null || size === undefined) return;
      const at = spotOf(event.nativeEvent.locationX, event.nativeEvent.locationY, size);

      if (stroke === null) {
        const dx = (at.x - start.x) * size.width;
        const dy = (at.y - start.y) * size.height;

        if (Math.hypot(dx, dy) < TAP_TOLERANCE) return;
        stroke = [start];
      }

      stroke = [...stroke, at];
      setDrawing(stroke);
    },
    onPanResponderRelease: (event) => {
      const drawn = stroke;
      const began = start;
      start = null;
      stroke = null;

      if (began === null || size === undefined) return;
      setDrawing(undefined);

      if (drawn !== null) {
        addMark({ kind: "stroke", points: drawn });

        return;
      }

      const at = spotOf(event.nativeEvent.locationX, event.nativeEvent.locationY, size);
      addMark({ kind: "point", point: { n: nextNumber, ...at, comment: "" } });
      setSelected(nextNumber);
    },
    onPanResponderTerminate: () => {
      start = null;
      stroke = null;
      setDrawing(undefined);
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
  const [size, setSize] = useState<Canvas | undefined>(undefined);

  const [marks, setMarks] = useState<Mark[]>(() =>
    (existing?.points ?? []).map((point) => ({ kind: "point", point })),
  );

  // The stroke under the finger, promoted to a mark on release.
  const [drawing, setDrawing] = useState<readonly Spot[] | undefined>(undefined);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const canvasRef = useRef<View>(null);

  const points = marks.flatMap((mark) => (mark.kind === "point" ? [mark.point] : []));
  const strokes = marks.flatMap((mark) => (mark.kind === "stroke" ? [mark.points] : []));
  const selectedPoint = points.find((point) => point.n === selected);
  const hasMarks = marks.length > 0;

  const nextNumber =
    marks.reduce((max, mark) => (mark.kind === "point" ? Math.max(max, mark.point.n) : max), 0) + 1;

  // Only the canvas size, the save lock, and the next number reach the
  // responder; the drag itself lives in its own closure.
  const responder = useMemo(
    () =>
      createAnnotateResponder({
        size,
        saving,
        nextNumber,
        addMark: (mark) => setMarks((current) => [...current, mark]),
        setDrawing,
        setSelected,
      }),
    [size, saving, nextNumber],
  );

  function writeComment(n: number, comment: string) {
    setMarks((current) =>
      current.map((mark) =>
        mark.kind === "point" && mark.point.n === n
          ? { kind: "point", point: { ...mark.point, comment } }
          : mark,
      ),
    );
  }

  function undo() {
    const last = marks[marks.length - 1];

    if (last === undefined) return;
    setMarks(marks.slice(0, -1));

    if (last.kind === "point" && last.point.n === selected) {
      setSelected(undefined);
      Keyboard.dismiss();
    }
  }

  function discard() {
    if (!hasMarks) {
      router.back();

      return;
    }

    Alert.alert("Discard markup?", "Your points and marks on this photo are removed.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }

  function closeComment() {
    setSelected(undefined);
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
      writeAnnotation(imageId, {
        image,
        points: points.map((point) => ({ ...point, comment: point.comment.trim() })),
      });
      router.back();
    } catch {
      setError("Couldn't save the markup. Try again.");
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: overCamera.backdrop }}>
      <html.div style={[styles.topBar, styles.topInset(insets.top)]}>
        <GlassButton
          label="Cancel markup"
          systemImage="xmark"
          iconOnly
          scheme="dark"
          onPress={discard}
        />
        <html.span style={[textStyles.title, styles.titleDark]}>Markup</html.span>
        <html.div style={styles.topActions}>
          <GlassButton
            label="Undo last mark"
            systemImage="arrow.uturn.backward"
            iconOnly
            scheme="dark"
            disabled={marks.length === 0 || saving}
            onPress={undo}
          />
          <GlassButton
            label="Clear marks"
            systemImage="trash"
            iconOnly
            scheme="dark"
            disabled={!hasMarks || saving}
            onPress={() => {
              setMarks([]);
              setDrawing(undefined);
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
              {[...strokes, ...(drawing === undefined ? [] : [drawing])].map((stroke, index) => (
                <Polyline
                  key={index}
                  points={stroke
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
                  value={selectedPoint.comment}
                  onChangeText={(text) => writeComment(selectedPoint.n, text)}
                  placeholder="What should change here?"
                  placeholderTextColor={themes.light.muted}
                  selectionColor={themes.light.accent}
                  returnKeyType="done"
                  onSubmitEditing={closeComment}
                  style={{
                    // The comment sits on a white pill over the photo, so it
                    // keeps the light palette in either appearance.
                    color: themes.light.foreground,
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
                onPress={closeComment}
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
  titleDark: { color: overCamera.foreground },
  topInset: (top: number) => ({ paddingTop: top + spacing.sm }),
  topActions: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentBar: {
    display: "flex",
    flexDirection: "column",
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
    backgroundColor: overCamera.foreground,
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
    borderColor: overCamera.foreground,
    justifyContent: "center",
    alignItems: "center",
  } satisfies ViewStyle,
  markerText: {
    color: overCamera.foreground,
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
    borderColor: overCamera.foreground,
  } satisfies ViewStyle,
};
