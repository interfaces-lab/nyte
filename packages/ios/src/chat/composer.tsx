import { memo, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Keyboard, ScrollView, TextInput, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Button, HStack, Host, Image, Menu, Text } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
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
import type { ModelInfo, SessionId } from "@nyte-ai/protocol";
import { describeHostError } from "../connection/connection.ts";
import { MAX_ATTACHMENTS, type StagedImage } from "../media/attachments.ts";
import {
  chooseSharedPhotos,
  readRecentPhotos,
  stageRecentPhoto,
  type PhotoAccess,
  type RecentPhoto,
} from "../media/recent-photos.ts";
import { clearAnnotation, resolveAttachment } from "../media/annotations.ts";
import { AttachmentThumb } from "../media/attachment-thumb.tsx";
import { CameraSheet } from "../media/camera-sheet.tsx";
import { AttachPanel } from "./attach-panel.tsx";
import { useModelCatalog } from "./remote-models.ts";
import { ContextRow } from "./context-row.tsx";
import type { UserContent } from "./remote-chat.ts";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";

/** Enough rows to scroll without asking the library for the whole roll. */
const PHOTO_PAGE = 24;
/** The capsule's inner padding, shared by the controls and the chips above it. */
const CAPSULE_PAD = 10;

type NewTarget = { kind: "new" };
type SessionTarget = {
  kind: "session";
  sessionId: SessionId;
  head: string;
  heads: readonly string[];
  sending: boolean;
  running: boolean;
  stopping: boolean;
  error: string | undefined;
  onSend: (content: UserContent) => Promise<boolean>;
  onStop: () => void;
};

/**
 * The one composer, on the list and in a conversation. The capsule holds the
 * plus, the field, and a right-hand disc that is mic or send; stop keeps its
 * own control. The plus grows the attachment choices above the capsule rather
 * than opening a picker over the screen, so the draft and the keyboard stay put.
 */
export const Composer = memo(function Composer({
  target,
  placeholder,
  prefill,
  composerRef,
  inputRef,
  onLayout,
}: {
  target: NewTarget | SessionTarget;
  placeholder: string;
  prefill?: { text: string; nonce: number };
  composerRef?: RefObject<View | null>;
  inputRef?: RefObject<TextInput | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const { client } = useHost();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [camera, setCamera] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [access, setAccess] = useState<PhotoAccess>();
  const [staging, setStaging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [model, setModel] = useState<ModelInfo>();
  const { catalog } = useModelCatalog(client, true);
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
  const chosenModel = model ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);
  const busy = sending || camera || staging;

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

  const loadPhotos = () => {
    void readRecentPhotos(PHOTO_PAGE)
      .then(setAccess)
      .catch(() => setAccess({ kind: "denied" }));
  };

  /** Opening the choices is the moment to ask for photo access, not app launch. */
  const toggleAttaching = () => {
    const next = !attaching;
    setAttaching(next);
    if (!next) return;
    setLocalError(undefined);
    loadPhotos();
  };

  const attachPhoto = async (photo: RecentPhoto) => {
    if (busy || images.length >= MAX_ATTACHMENTS) return;
    setAttaching(false);
    setStaging(true);
    setLocalError(undefined);
    try {
      const staged = await stageRecentPhoto(photo);
      setImages((current) => [...current, staged].slice(0, MAX_ATTACHMENTS));
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Couldn't attach that photo.");
    } finally {
      setStaging(false);
    }
  };

  const chooseHead = (head: string) => {
    if (target.kind !== "session") return;
    void client.sessions
      .configure({ sessionId: target.sessionId, head })
      .catch((cause: unknown) => setLocalError(describeHostError(cause)));
  };

  const chooseModel = (choice: ModelInfo) => {
    setModel(choice);
    // A conversation already exists, so the change lands now instead of waiting
    // for the next send.
    if (target.kind === "session") {
      void client.sessions
        .configure({
          sessionId: target.sessionId,
          model: { provider: choice.provider, id: choice.id },
        })
        .catch((cause: unknown) => setLocalError(describeHostError(cause)));
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
          styles.insets(insets.left + spacing.md, insets.right + spacing.md, insets.bottom / 2),
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
        {staging ? (
          <html.div style={styles.attachmentStatus} aria-live="polite">
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Preparing photo…</html.span>
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
        <AttachPanel
          open={attaching}
          disabled={busy || images.length >= MAX_ATTACHMENTS}
          access={access}
          onPick={(photo) => void attachPhoto(photo)}
          onManageAccess={() => {
            void chooseSharedPhotos().then(loadPhotos);
          }}
          onTakePhoto={() => {
            setAttaching(false);
            setLocalError(undefined);
            Keyboard.dismiss();
            setCamera(true);
          }}
        />
        <html.div style={styles.card}>
          <ContextRow
            head={target.kind === "session" ? target.head : undefined}
            heads={target.kind === "session" ? target.heads : []}
            onChooseHead={chooseHead}
          />
          <TextInput
            ref={inputRef}
            accessibilityLabel={placeholder}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            // Each transcript rewrites the field, so hand editing waits for the stop.
            editable={!sending && !dictation.recording}
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Host
              style={{ width: controls.composerButton, height: controls.composerButton }}
              ignoreSafeArea="all"
            >
              <Button
                label={attaching ? "Close attachment choices" : "Add attachment"}
                systemImage={attaching ? "xmark" : "plus"}
                onPress={toggleAttaching}
                modifiers={[
                  buttonStyle("glass"),
                  buttonBorderShape("circle"),
                  controlSize("small"),
                  labelStyle("iconOnly"),
                  font({ size: typography.body.fontSize, weight: "medium" }),
                  tint(theme.foreground),
                  disabled(busy || images.length >= MAX_ATTACHMENTS),
                ]}
              />
            </Host>
            {catalog.kind === "ready" ? (
              <Host
                matchContents={{ horizontal: true }}
                style={{ height: controls.metaTarget }}
                ignoreSafeArea="all"
              >
                <Menu
                  label={
                    <HStack spacing={4}>
                      <Text
                        modifiers={[
                          font({ size: typography.caption.fontSize, weight: "medium" }),
                          foregroundStyle(theme.muted),
                        ]}
                      >
                        {chosenModel?.name ?? "Model"}
                      </Text>
                      <Image
                        systemName="chevron.down"
                        size={10}
                        modifiers={[foregroundStyle(theme.muted)]}
                      />
                    </HStack>
                  }
                  modifiers={[buttonStyle("plain")]}
                >
                  {catalog.models.map((item) => (
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
                      onPress={() => chooseModel(item)}
                    />
                  ))}
                </Menu>
              </Host>
            ) : null}
            <View style={{ flexGrow: 1 }} />
            {running && !dictation.recording ? (
              <html.button
                aria-label={stopping ? "Stopping" : "Stop"}
                disabled={stopping}
                onClick={target.kind === "session" ? target.onStop : undefined}
                style={[styles.disc, styles.discStop, stopping && styles.discDisabled]}
              >
                <SymbolView name="stop.fill" size={13} tintColor={theme.foreground} />
              </html.button>
            ) : null}
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
      </html.div>
      <CameraSheet
        visible={camera}
        onClose={() => setCamera(false)}
        onCapture={(image) => setImages((current) => [...current, image].slice(0, MAX_ATTACHMENTS))}
      />
    </View>
  );
});

const styles = css.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    padding: CAPSULE_PAD,
    borderRadius: radii.bubble,
    borderWidth: controls.borderWidth,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
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
    top: -8,
    right: -8,
    width: controls.photoRemoveTarget,
    height: controls.photoRemoveTarget,
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
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
  discPrimary: { backgroundColor: tokens.primary },
  discStop: { backgroundColor: tokens.fill },
  discDisabled: { opacity: controls.disabledOpacity },
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
  },
  modelRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    // Optically flush with the capsule's contents, not its border.
    paddingInlineStart: CAPSULE_PAD,
    paddingBottom: spacing.xs,
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
    paddingBottom: bottom,
  }),
});
