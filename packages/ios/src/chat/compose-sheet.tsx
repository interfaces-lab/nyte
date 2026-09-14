import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, ScrollView, TextInput, View } from "react-native";
import { Button, Host, Menu } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  font,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import type { ModelInfo } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";
import { describeHostError } from "../connection/connection.ts";
import { useModelCatalog } from "./remote-models.ts";
import type { UserContent } from "./remote-chat.ts";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";
import { MAX_ATTACHMENTS, pickImages, type StagedImage } from "../media/attachments.ts";
import { clearAnnotation, resolveAttachment } from "../media/annotations.ts";
import { AttachmentThumb } from "../media/attachment-thumb.tsx";
import { CameraSheet } from "../media/camera-sheet.tsx";
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

export function ComposeSheet() {
  const theme = useTheme();
  const { client, connection } = useHost();
  const { dictate } = useLocalSearchParams<{ dictate?: string }>();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [source, setSource] = useState<"photos" | "camera">();
  const [model, setModel] = useState<ModelInfo | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const dictationBase = useRef("");
  const dictateRequested = useRef(dictate === "1" || dictate === "true");
  const dictation = useDictation((transcript) => {
    const base = dictationBase.current;
    setDraft(base === "" || transcript === "" ? base + transcript : `${base} ${transcript}`);
  });
  const { catalog } = useModelCatalog(client, true);

  useEffect(() => {
    if (!dictateRequested.current) return;
    dictateRequested.current = false;
    void startDictation();
    // Dictation starts once on open; later re-renders shouldn't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPhotos = async () => {
    if (starting || source !== undefined || images.length >= MAX_ATTACHMENTS) return;
    setSource("photos");
    setError(undefined);
    try {
      const picked = await pickImages(MAX_ATTACHMENTS - images.length);
      setImages((current) => [...current, ...picked.images].slice(0, MAX_ATTACHMENTS));
      if (picked.failed > 0)
        setError(
          `Couldn't add ${String(picked.failed)} ${picked.failed === 1 ? "photo" : "photos"}. Try a smaller image.`,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open photos. Try again.");
    } finally {
      setSource(undefined);
    }
  };

  const startDictation = async () => {
    dictationBase.current = draft.trimEnd();
    await dictation.start();
  };

  async function send() {
    const text = draft.trim();
    if (starting || (text === "" && images.length === 0)) return;
    dictation.stop();
    setStarting(true);
    setError(undefined);
    try {
      const notes = images
        .map((image) => resolveAttachment(image).note)
        .filter((note) => note !== undefined);
      const content: UserContent = [
        ...(text === "" ? [] : [{ type: "text" as const, text }]),
        ...images.map((image) => resolveAttachment(image).image.image),
        ...notes.map((note) => ({ type: "text" as const, text: note })),
      ];
      const name = text.split("\n")[0]?.slice(0, 48) ?? "";
      const session = await client.sessions.create({
        name: name === "" ? "New conversation" : name,
      });
      if (model !== undefined) {
        await client.sessions.configure({
          sessionId: session.sessionId,
          model: { provider: model.provider, id: model.id },
        });
      }
      await client.messages.send({
        sessionId: session.sessionId,
        content,
        key: randomUUID(),
      });
      for (const image of images) clearAnnotation(image.id);
      router.dismissTo(`/chat/${session.sessionId}`);
    } catch (cause) {
      setError(describeHostError(cause));
      setStarting(false);
    }
  }

  const models = catalog.kind === "ready" ? catalog.models : [];
  const chosenModel = model ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);
  const hasContent = draft.trim() !== "" || images.length > 0;

  return (
    <View style={{ flex: 1 }}>
      <html.div
        data-layoutconformance="strict"
        style={[styles.sheet, styles.bottomInset(insets.bottom)]}
      >
        <html.div style={styles.context}>
          <SymbolView name="laptopcomputer" size={13} tintColor={theme.muted} />
          <html.span style={[textStyles.secondary, styles.contextText]}>
            {connection.name}
          </html.span>
        </html.div>
        <ScrollView
          style={{ flexGrow: 1, flexBasis: 0 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <TextInput
            accessibilityLabel="Describe the task"
            value={draft}
            onChangeText={setDraft}
            placeholder="Plan, ask, build…"
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            editable={!starting && !dictation.recording}
            multiline
            autoFocus
            style={{
              color: dictation.recording ? theme.accent : theme.foreground,
              ...typography.body,
              paddingVertical: spacing.sm,
              minHeight: 88,
            }}
          />
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
                    disabled={starting}
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
        </ScrollView>
        {error !== undefined || dictation.error !== undefined ? (
          <html.p role="alert" style={textStyles.error}>
            {error ?? dictation.error}
          </html.p>
        ) : null}
        <html.div style={styles.toolbar}>
          <Host
            style={{ width: controls.composerButton, height: controls.composerButton }}
            ignoreSafeArea="all"
          >
            <Menu
              label={source === "photos" ? "Preparing photos" : "Add attachment"}
              systemImage="plus"
              modifiers={[
                buttonStyle("bordered"),
                buttonBorderShape("circle"),
                controlSize("regular"),
                labelStyle("iconOnly"),
                font({ size: typography.body.fontSize, weight: "medium" }),
                tint(theme.foreground),
                disabled(starting || source !== undefined || images.length >= MAX_ATTACHMENTS),
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
                  setError(undefined);
                  setSource("camera");
                }}
              />
            </Menu>
          </Host>
          {catalog.kind === "ready" ? (
            <Host
              matchContents={{ horizontal: true }}
              style={{ height: controls.composerButton }}
              ignoreSafeArea="all"
            >
              <Menu
                label={chosenModel?.name ?? "Model"}
                modifiers={[buttonStyle("plain"), tint(theme.foreground)]}
              >
                {models.map((item) => (
                  <Button
                    key={`${item.provider}/${item.id}`}
                    label={item.name}
                    systemImage={
                      chosenModel !== undefined &&
                      item.provider === chosenModel.provider &&
                      item.id === chosenModel.id
                        ? "checkmark"
                        : undefined
                    }
                    onPress={() => setModel(item)}
                  />
                ))}
              </Menu>
            </Host>
          ) : catalog.kind === "failed" ? (
            <html.span style={textStyles.secondary}>Host default</html.span>
          ) : null}
          <html.div style={styles.recorder}>
            {dictation.recording ? (
              <html.button
                aria-label={`Stop dictation, ${formatElapsed(dictation.elapsed)}`}
                onClick={dictation.stop}
                style={styles.recorderPill}
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
            ) : (
              <>
                {starting ? <ActivityIndicator color={theme.muted} /> : null}
                {hasContent ? (
                  <html.button
                    aria-label={starting ? "Starting task" : "Send task"}
                    disabled={starting || source !== undefined}
                    onClick={() => void send()}
                    style={[styles.disc, styles.discPrimary]}
                  >
                    <SymbolView
                      name="arrow.up"
                      size={controls.iconSm}
                      weight="semibold"
                      tintColor={theme.onPrimary}
                    />
                  </html.button>
                ) : (
                  <html.button
                    aria-label="Dictate"
                    onClick={() => void startDictation()}
                    style={[styles.disc, styles.discRaised]}
                  >
                    <SymbolView
                      name="mic.fill"
                      size={controls.iconSm}
                      tintColor={theme.foreground}
                    />
                  </html.button>
                )}
              </>
            )}
          </html.div>
        </html.div>
      </html.div>
      <CameraSheet
        visible={source === "camera"}
        onClose={() => setSource(undefined)}
        onCapture={(image) => setImages((current) => [...current, image].slice(0, MAX_ATTACHMENTS))}
      />
    </View>
  );
}

const styles = css.create({
  sheet: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingInline: spacing.gutter,
    paddingTop: spacing.gutter,
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom + spacing.sm }),
  context: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.xs },
  contextText: { flexShrink: 1, lineClamp: 1 },
  toolbar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
  },
  recorder: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  recorderPill: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: controls.chipHeight,
    paddingInline: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 0,
    backgroundColor: { default: tokens.fill, ":active": tokens.raised },
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
  disc: {
    width: controls.composerButton,
    height: controls.composerButton,
    borderRadius: radii.pill,
    borderWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  discPrimary: { backgroundColor: tokens.primary },
  discRaised: { backgroundColor: tokens.fill },
  attachment: {
    position: "relative",
    width: media.attachmentSize,
    height: media.attachmentSize,
  },
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
});
