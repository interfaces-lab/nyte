import { memo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ActivityIndicator, Keyboard, ScrollView, TextInput, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Button, Host, Menu } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  controls,
  conversation,
  media,
  nativeTheme,
  radii,
  spacing,
  textStyles,
  tokens,
  typography,
} from "../theme.ts";
import { MAX_ATTACHMENTS, pickImages, type StagedImage } from "../media/attachments.ts";
import { CameraSheet } from "../media/camera-sheet.tsx";
import type { UserContent } from "./remote-chat.ts";
import type { ConversationLayout } from "./conversation-layout.ts";
import { GlassButton } from "../ui/glass-button.tsx";
export const Composer = memo(function Composer({
  layout,
  sending,
  error,
  selectingModel,
  running,
  stopping,
  onSend,
  onStop,
  composerRef,
  onLayout,
  children,
}: {
  layout: ConversationLayout;
  sending: boolean;
  error: string | undefined;
  selectingModel: boolean;
  onSend: (content: UserContent) => Promise<boolean>;
  onStop: () => void;
  children: ReactNode;
  running: boolean;
  stopping: boolean;
  composerRef: RefObject<View | null>;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [source, setSource] = useState<"photos" | "camera">();
  const [attachmentError, setAttachmentError] = useState<string>();
  const [oneLineHeight, setOneLineHeight] = useState<number>();
  const insets = useSafeAreaInsets();
  const submit = async () => {
    if (
      sending ||
      selectingModel ||
      source !== undefined ||
      (draft.trim() === "" && images.length === 0)
    )
      return;
    const submitted = draft;
    const submittedImages = images;
    const content: UserContent =
      images.length === 0
        ? submitted
        : [
            ...(submitted.trim() === "" ? [] : [{ type: "text" as const, text: submitted }]),
            ...images.map((item) => item.image),
          ];
    if (await onSend(content)) {
      setAttachmentError(undefined);
      setDraft((current) => (current === submitted ? "" : current));
      setImages((current) => current.filter((image) => !submittedImages.includes(image)));
    }
  };
  const addPhotos = async () => {
    if (sending || source !== undefined || images.length >= MAX_ATTACHMENTS) return;
    setSource("photos");
    setAttachmentError(undefined);
    try {
      const picked = await pickImages(MAX_ATTACHMENTS - images.length);
      setImages((current) => [...current, ...picked.images].slice(0, MAX_ATTACHMENTS));
      if (picked.failed > 0)
        setAttachmentError(
          `Couldn't add ${String(picked.failed)} ${picked.failed === 1 ? "photo" : "photos"}. Try a smaller image.`,
        );
    } catch (cause) {
      setAttachmentError(
        cause instanceof Error ? cause.message : "Couldn't open photos. Try again.",
      );
    } finally {
      setSource(undefined);
    }
  };
  return (
    <View ref={composerRef} onLayout={onLayout}>
      <html.div
        style={[
          styles.composer,
          styles.insets(layout.paddingLeft, layout.paddingRight, insets.bottom),
        ]}
      >
        {images.length > 0 ? (
          <ScrollView
            horizontal
            contentContainerStyle={{ gap: spacing.sm, paddingBlock: spacing.sm }}
            keyboardShouldPersistTaps="handled"
          >
            {images.map((image, index) => (
              <html.div key={image.id} style={styles.attachment}>
                <html.img
                  src={image.uri}
                  alt={`Attached photo ${index + 1}`}
                  style={styles.attachmentImage}
                />
                <html.button
                  aria-label={`Remove photo ${index + 1}`}
                  disabled={sending}
                  onClick={() => setImages((current) => current.filter((item) => item !== image))}
                  style={styles.removePhoto}
                >
                  {/* A dark disc keeps the glyph legible over bright photos. */}
                  <SymbolView
                    name="xmark.circle.fill"
                    size={controls.icon}
                    type="palette"
                    colors={[nativeTheme.foreground, nativeTheme.background]}
                  />
                </html.button>
              </html.div>
            ))}
          </ScrollView>
        ) : null}
        {source === "photos" ? (
          <html.div style={styles.attachmentStatus} aria-live="polite">
            <ActivityIndicator color={nativeTheme.muted} />
            <html.span style={textStyles.caption}>Preparing photos…</html.span>
          </html.div>
        ) : images.length >= MAX_ATTACHMENTS ? (
          <html.p style={textStyles.caption}>
            {`Up to ${String(MAX_ATTACHMENTS)} photos per message.`}
          </html.p>
        ) : null}
        {error || attachmentError ? (
          <html.p role="alert" style={textStyles.error}>
            {error ?? attachmentError}
          </html.p>
        ) : null}
        <html.div style={styles.composerRow}>
          <Host
            style={{ width: controls.touchTarget, height: controls.touchTarget }}
            colorScheme="dark"
            ignoreSafeArea="all"
          >
            <Menu
              label={source === "photos" ? "Preparing photos" : "Add attachment"}
              systemImage="plus"
              modifiers={[
                buttonStyle("glass"),
                buttonBorderShape("circle"),
                controlSize("large"),
                labelStyle("iconOnly"),
                tint(nativeTheme.foreground),
                disabled(sending || source !== undefined || images.length >= MAX_ATTACHMENTS),
              ]}
            >
              <Button
                label="Photo Library"
                systemImage="photo"
                onPress={() => {
                  void addPhotos();
                }}
              />
              <Button
                label="Take Photo"
                systemImage="camera"
                onPress={() => {
                  Keyboard.dismiss();
                  setAttachmentError(undefined);
                  setSource("camera");
                }}
              />
            </Menu>
          </Host>
          <html.div style={styles.inputShell}>
            <TextInput
              accessibilityLabel="Message Nyte"
              value={draft}
              onChangeText={setDraft}
              placeholder="Message Nyte…"
              placeholderTextColor={nativeTheme.muted}
              selectionColor={nativeTheme.accent}
              editable={!sending}
              multiline
              onLayout={(event) =>
                setOneLineHeight((current) => current ?? event.nativeEvent.layout.height)
              }
              style={{
                color: nativeTheme.foreground,
                ...typography.title,
                fontWeight: typography.body.fontWeight,
                paddingVertical: spacing.sm,
                paddingHorizontal: conversation.textInset,
                maxHeight: controls.composerMaxHeight,
                minHeight: controls.touchTarget,
                height: draft === "" ? oneLineHeight : undefined,
              }}
            />
          </html.div>
          {running ? (
            <GlassButton
              label={stopping ? "Stopping run" : "Stop run"}
              systemImage="stop.fill"
              iconOnly
              disabled={stopping}
              onPress={onStop}
            />
          ) : null}
          <GlassButton
            label={sending ? "Sending message" : "Send message"}
            systemImage="arrow.up"
            iconOnly
            prominent
            disabled={
              sending ||
              selectingModel ||
              source !== undefined ||
              (draft.trim() === "" && images.length === 0)
            }
            onPress={() => {
              void submit();
            }}
          />
        </html.div>
        <html.div style={styles.composerToolbar}>
          <html.div style={styles.modelControl}>{children}</html.div>
        </html.div>
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
    paddingTop: spacing.sm,
    backgroundColor: tokens.background,
  },
  attachment: { position: "relative", width: media.attachmentSize, height: media.attachmentSize },
  attachmentImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: radii.control,
  },
  removePhoto: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
    position: "absolute",
    top: 0,
    right: 0,
    width: controls.touchTarget,
    height: controls.touchTarget,
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
  composerToolbar: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.xs },
  modelControl: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  composerRow: { display: "flex", flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  insets: (left: number, right: number, bottom: number) => ({
    paddingLeft: left,
    paddingRight: right,
    paddingBottom: bottom + spacing.sm,
  }),
  inputShell: {
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: tokens.surface,
    borderRadius: radii.bubble,
    borderWidth: controls.borderWidth,
    borderStyle: "solid",
    borderColor: tokens.border,
    overflow: "hidden",
  },
});
