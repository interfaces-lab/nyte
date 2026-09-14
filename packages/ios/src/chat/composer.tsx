import { memo, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Button, Host, Menu, Rectangle } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  font,
  frame,
  glassEffect,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  controls,
  media,
  useTheme,
  radii,
  spacing,
  textStyles,
  tokens,
  typography,
} from "../theme.ts";
import { useHost } from "../connection/host-context.tsx";
import { describeHostError } from "../connection/connection.ts";
import { MAX_ATTACHMENTS, pickImages, type StagedImage } from "../media/attachments.ts";
import { clearAnnotation, resolveAttachment } from "../media/annotations.ts";
import { AttachmentThumb } from "../media/attachment-thumb.tsx";
import { CameraSheet } from "../media/camera-sheet.tsx";
import type { UserContent } from "./remote-chat.ts";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";

/** Frost behind the capsule. TextInput stays in RN; SwiftUI cannot host it. */
function CapsuleMaterial({ stadium }: { stadium: boolean }) {
  const effect = stadium
    ? glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" })
    : glassEffect({
        glass: { variant: "regular", interactive: true },
        shape: "roundedRectangle",
        cornerRadius: radii.bubble,
      });
  return (
    <Host style={StyleSheet.absoluteFill} pointerEvents="none" ignoreSafeArea="all">
      <Rectangle modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), effect]} />
    </Host>
  );
}

type NewTarget = { kind: "new" };
type SessionTarget = {
  kind: "session";
  sending: boolean;
  running: boolean;
  stopping: boolean;
  error: string | undefined;
  onSend: (content: UserContent) => Promise<boolean>;
  onStop: () => void;
};

/**
 * The single capsule composer from the study: a plus menu, the field, and one
 * disc — mic, send, or stop — on the right.
 */
export const Composer = memo(function Composer({
  target,
  placeholder,
  prefill,
  composerRef,
  onLayout,
}: {
  target: NewTarget | SessionTarget;
  placeholder: string;
  prefill?: { text: string; nonce: number };
  composerRef?: RefObject<View | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const { client } = useHost();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [source, setSource] = useState<"photos" | "camera">();
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [multiline, setMultiline] = useState(false);
  const insets = useSafeAreaInsets();
  const dictationBase = useRef("");
  const dictation = useDictation((transcript) => {
    const base = dictationBase.current;
    setDraft(base === "" || transcript === "" ? base + transcript : `${base} ${transcript}`);
  });

  const lastPrefill = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prefill === undefined || prefill.nonce === lastPrefill.current) return;
    lastPrefill.current = prefill.nonce;
    setDraft(prefill.text);
  }, [prefill]);

  const sending = target.kind === "session" ? target.sending : starting;
  const running = target.kind === "session" ? target.running : false;
  const stopping = target.kind === "session" ? target.stopping : false;
  const error =
    localError ?? dictation.error ?? (target.kind === "session" ? target.error : undefined);
  const hasContent = draft.trim() !== "" || images.length > 0;
  const busy = sending || source !== undefined;

  function buildContent(): UserContent {
    const text = draft.trim();
    const notes = images
      .map((image) => resolveAttachment(image).note)
      .filter((note) => note !== undefined);
    return [
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
      ...images.map((image) => resolveAttachment(image).image.image),
      ...notes.map((note) => ({ type: "text" as const, text: note })),
    ];
  }

  const clearSubmitted = (submitted: string, submittedImages: readonly StagedImage[]) => {
    setLocalError(undefined);
    setDraft((current) => (current === submitted ? "" : current));
    setImages((current) => current.filter((image) => !submittedImages.includes(image)));
    for (const image of submittedImages) clearAnnotation(image.id);
  };

  const submit = async () => {
    if (busy || !hasContent || dictation.recording) return;
    const submitted = draft;
    const submittedImages = images;
    const content = buildContent();
    if (target.kind === "new") {
      setStarting(true);
      setLocalError(undefined);
      try {
        const name = draft.trim().split("\n")[0]?.slice(0, 48) ?? "";
        const session = await client.sessions.create({
          name: name === "" ? "New conversation" : name,
        });
        await client.messages.send({
          sessionId: session.sessionId,
          content,
          key: randomUUID(),
        });
        clearSubmitted(submitted, submittedImages);
        Keyboard.dismiss();
        router.push(`/chat/${session.sessionId}`);
      } catch (cause) {
        setLocalError(describeHostError(cause));
      } finally {
        setStarting(false);
      }
      return;
    }
    if (await target.onSend(content)) clearSubmitted(submitted, submittedImages);
  };

  const addPhotos = async () => {
    if (busy || images.length >= MAX_ATTACHMENTS) return;
    setSource("photos");
    setLocalError(undefined);
    try {
      const picked = await pickImages(MAX_ATTACHMENTS - images.length);
      setImages((current) => [...current, ...picked.images].slice(0, MAX_ATTACHMENTS));
      if (picked.failed > 0)
        setLocalError(
          `Couldn't add ${String(picked.failed)} ${picked.failed === 1 ? "photo" : "photos"}. Try a smaller image.`,
        );
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Couldn't open photos. Try again.");
    } finally {
      setSource(undefined);
    }
  };

  const startDictation = async () => {
    dictationBase.current = draft.trimEnd();
    await dictation.start();
  };

  return (
    <View ref={composerRef} onLayout={onLayout}>
      <html.div
        style={[
          styles.composer,
          styles.insets(insets.left + spacing.md, insets.right + spacing.md, insets.bottom),
        ]}
      >
        {images.length > 0 ? (
          <ScrollView
            horizontal
            contentContainerStyle={{ gap: spacing.sm, paddingBlock: spacing.xs }}
            keyboardShouldPersistTaps="handled"
          >
            {images.map((image, index) => (
              <html.div key={image.id} style={styles.attachment}>
                <html.button
                  aria-label={`Annotate photo ${index + 1}`}
                  onClick={() =>
                    router.push(
                      `/annotate?imageId=${encodeURIComponent(image.id)}&uri=${encodeURIComponent(image.uri)}`,
                    )
                  }
                  style={styles.attachmentButton}
                >
                  <AttachmentThumb
                    image={image}
                    alt={`Attached photo ${index + 1}`}
                    style={styles.attachmentImage}
                  />
                </html.button>
                <html.button
                  aria-label={`Remove photo ${index + 1}`}
                  disabled={sending}
                  onClick={() => {
                    clearAnnotation(image.id);
                    setImages((current) => current.filter((item) => item !== image));
                  }}
                  style={styles.removePhoto}
                >
                  <SymbolView
                    name="xmark.circle.fill"
                    size={controls.badge}
                    type="palette"
                    colors={[theme.foreground, theme.surface]}
                  />
                </html.button>
              </html.div>
            ))}
          </ScrollView>
        ) : null}
        {source === "photos" ? (
          <html.div style={styles.attachmentStatus} aria-live="polite">
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Preparing photos…</html.span>
          </html.div>
        ) : images.length >= MAX_ATTACHMENTS ? (
          <html.p style={textStyles.caption}>
            {`Up to ${String(MAX_ATTACHMENTS)} photos per message.`}
          </html.p>
        ) : null}
        {error ? (
          <html.p role="alert" style={textStyles.error}>
            {error}
          </html.p>
        ) : null}
        <View
          style={{
            position: "relative",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: spacing.sm,
            minHeight: controls.composerHeight,
            borderRadius: multiline ? radii.bubble : radii.composer,
            padding: 10,
          }}
        >
          <CapsuleMaterial stadium={!multiline} />
          <Host
            style={{ width: controls.composerButton, height: controls.composerButton }}
            ignoreSafeArea="all"
          >
            <Menu
              label={source === "photos" ? "Preparing photos" : "Add attachment"}
              systemImage="plus"
              modifiers={[
                buttonStyle("glass"),
                buttonBorderShape("circle"),
                controlSize("small"),
                labelStyle("iconOnly"),
                font({ size: typography.body.fontSize, weight: "medium" }),
                tint(theme.foreground),
                disabled(sending || source !== undefined || images.length >= MAX_ATTACHMENTS),
              ]}
            >
              <Button
                label="Photo Library"
                systemImage="photo.on.rectangle"
                onPress={() => {
                  void addPhotos();
                }}
              />
              <Button
                label="Take Photo"
                systemImage="camera"
                onPress={() => {
                  Keyboard.dismiss();
                  setLocalError(undefined);
                  setSource("camera");
                }}
              />
            </Menu>
          </Host>
          <TextInput
            accessibilityLabel={placeholder}
            value={draft}
            onChangeText={setDraft}
            onContentSizeChange={(event) =>
              setMultiline(event.nativeEvent.contentSize.height > typography.body.lineHeight + 8)
            }
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            editable={!sending}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              color: dictation.recording ? theme.accent : theme.foreground,
              ...typography.body,
              paddingVertical: 5,
              paddingHorizontal: spacing.xs,
              maxHeight: controls.composerMaxHeight,
              minHeight: controls.composerButton,
              backgroundColor: "transparent",
            }}
          />
          {dictation.recording ? (
            <html.button
              aria-label={`Stop dictation, ${formatElapsed(dictation.elapsed)}`}
              onClick={dictation.stop}
              style={styles.recorder}
            >
              <SymbolView
                name="stop.circle.fill"
                size={controls.badge}
                tintColor={theme.foreground}
              />
              <html.span style={[textStyles.secondary, styles.recorderTime]}>
                {formatElapsed(dictation.elapsed)}
              </html.span>
              <html.div style={styles.waveform} aria-hidden>
                {dictation.levels.map((level, index) => (
                  <html.div key={index} style={[styles.waveBar, styles.waveBarHeight(level)]} />
                ))}
              </html.div>
            </html.button>
          ) : hasContent ? (
            <html.button
              aria-label={sending ? "Sending" : "Send"}
              disabled={busy}
              onClick={() => {
                void submit();
              }}
              style={[styles.disc, styles.discPrimary]}
            >
              {sending ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <SymbolView
                  name="arrow.up"
                  size={controls.iconSm}
                  weight="semibold"
                  tintColor={theme.onPrimary}
                />
              )}
            </html.button>
          ) : running ? (
            <html.button
              aria-label={stopping ? "Stopping" : "Stop"}
              disabled={stopping}
              onClick={target.kind === "session" ? target.onStop : undefined}
              style={[styles.disc, styles.discPrimary]}
            >
              <SymbolView name="stop.fill" size={13} tintColor={theme.onPrimary} />
            </html.button>
          ) : (
            <Host
              style={{ width: controls.composerButton, height: controls.composerButton }}
              ignoreSafeArea="all"
            >
              <Button
                label="Dictate"
                systemImage="mic.fill"
                onPress={() => {
                  void startDictation();
                }}
                modifiers={[
                  buttonStyle("glass"),
                  buttonBorderShape("circle"),
                  controlSize("small"),
                  labelStyle("iconOnly"),
                  font({ size: typography.body.fontSize, weight: "medium" }),
                  tint(theme.foreground),
                ]}
              />
            </Host>
          )}
        </View>
      </html.div>
      <CameraSheet
        visible={source === "camera"}
        onClose={() => setSource(undefined)}
        onCapture={(image) => setImages((current) => [...current, image].slice(0, MAX_ATTACHMENTS))}
      />
    </View>
  );
});

const styles = css.create({
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  attachment: { position: "relative", width: media.attachmentSize, height: media.attachmentSize },
  attachmentButton: { borderWidth: 0, padding: 0, width: "100%", height: "100%" },
  attachmentImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: radii.control,
  },
  removePhoto: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
    position: "absolute",
    top: -4,
    right: -4,
    width: controls.metaTarget,
    height: controls.metaTarget,
    borderWidth: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  attachmentStatus: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  disc: {
    width: controls.composerButton,
    height: controls.composerButton,
    borderRadius: radii.pill,
    borderWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  discPrimary: { backgroundColor: tokens.primary },
  recorder: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: spacing.sm,
    height: controls.chipHeight,
    paddingInline: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 0,
    flexShrink: 0,
  },
  recorderTime: { color: tokens.foreground, fontVariant: "tabular-nums" },
  waveform: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    height: 16,
    overflow: "hidden",
  },
  waveBar: { width: 3, borderRadius: radii.pill, backgroundColor: tokens.muted },
  waveBarHeight: (level: number) => ({ height: waveHeight(level) }),
  insets: (left: number, right: number, bottom: number) => ({
    paddingLeft: left,
    paddingRight: right,
    paddingBottom: bottom + spacing.md,
  }),
});
