import { memo, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Keyboard, ScrollView, TextInput, View } from "react-native";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
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
import { SuggestionMenu } from "./suggestion-menu.tsx";
import { acceptSuggestion, parseCommandLine, useCompletions } from "./completions.ts";
import type { CommandLine, Suggestion } from "./completions.ts";
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
  backdrop,
  gutters,
}: {
  target: NewTarget | SessionTarget;
  placeholder: string;
  prefill?: { text: string; nonce: number };
  /** What the screen behind the bar paints, so the opaque bar matches it. */
  backdrop: "background" | "canvas";
  /**
   * The screen's content column, safe area included. The capsule lines up with
   * the rows above it rather than keeping a gutter of its own.
   */
  gutters: { left: number; right: number };
}) {
  const theme = useTheme();
  const { client } = useHost();
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [images, setImages] = useState<StagedImage[]>([]);
  const [camera, setCamera] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [access, setAccess] = useState<PhotoAccess>();
  const [staging, setStaging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [model, setModel] = useState<ModelInfo>();
  const { catalog } = useModelCatalog(client, true);
  const insets = useSafeAreaInsets();
  const fieldRef = useRef<TextInput>(null);
  const keyboard = useReanimatedKeyboardAnimation();
  const sessionId = target.kind === "session" ? target.sessionId : undefined;
  const { completion, commands } = useCompletions(client, sessionId, draft, caret, focused);
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

  /**
   * One send, whichever target it lands on. A draft that is only a command line
   * runs the command the way the desktop composer does; anything else is a
   * message. The host says what a command did: output to show, a prompt to send
   * as the user, or a name it does not know, which travels as the text it reads as.
   */
  const deliver = async (input: {
    sessionId: SessionId;
    content: UserContent;
    line: CommandLine | undefined;
    send: (content: UserContent) => Promise<boolean>;
  }): Promise<boolean> => {
    if (input.line === undefined) return input.send(input.content);
    const outcome = await client.plugins.commands.run({
      sessionId: input.sessionId,
      ...input.line,
    });
    switch (outcome.kind) {
      case "ran":
        setNotice(outcome.output);
        return true;
      case "prompt":
        return input.send([{ type: "text", text: outcome.prompt }]);
      case "not_found":
        return input.send(input.content);
      case "failed":
        setLocalError(outcome.message);
        return false;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };

  const submit = async () => {
    if (busy || !hasContent || dictation.recording) return;
    const submitted = draft;
    const submittedImages = images;
    const content = buildContent();
    // Photos make the draft a message even when its text names a command.
    const line = images.length === 0 ? parseCommandLine(draft, commands) : undefined;
    setNotice(undefined);
    if (target.kind === "new") {
      setStarting(true);
      setLocalError(undefined);
      try {
        // A command line is not a title; the command names the conversation it starts.
        const typed = draft.trim().split("\n")[0]?.slice(0, 48) ?? "";
        const name = line?.name ?? (typed === "" ? "New conversation" : typed);
        const session = await client.sessions.create({ name });
        if (model !== undefined) {
          await client.sessions.configure({
            sessionId: session.sessionId,
            model: { provider: model.provider, id: model.id },
          });
        }
        const accepted = await deliver({
          sessionId: session.sessionId,
          content,
          line,
          send: async (message) => {
            await client.messages.send({
              sessionId: session.sessionId,
              content: message,
              key: randomUUID(),
            });
            return true;
          },
        });
        if (!accepted) return;
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
    try {
      if (await deliver({ sessionId: target.sessionId, content, line, send: target.onSend }))
        clearSubmitted(submitted, submittedImages);
    } catch (cause) {
      setLocalError(describeHostError(cause));
    }
  };

  /** Accepting a choice rewrites the token and leaves the caret after it. */
  const accept = (suggestion: Suggestion) => {
    if (completion === undefined) return;
    const next = acceptSuggestion(draft, completion.trigger, suggestion);
    setDraft(next.draft);
    setCaret(next.caret);
    fieldRef.current?.setSelection(next.caret, next.caret);
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

  // The sticky view lands the composer on the keyboard's top edge; this keeps a
  // resting gap above the home indicator without leaving one over the keyboard.
  const keyboardInset = useAnimatedStyle(() => ({
    paddingBottom: insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.value,
  }));

  return (
    <Animated.View
      // A native view, so the bar's fill is a raw color rather than an RSD rule.
      style={[
        { backgroundColor: backdrop === "canvas" ? theme.canvas : theme.background },
        keyboardInset,
      ]}
    >
      <html.div style={[styles.composer, styles.insets(gutters.left, gutters.right)]}>
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
        ) : notice === undefined ? null : (
          <html.p role="status" style={textStyles.caption}>
            {notice}
          </html.p>
        )}
        <AttachPanel
          // The token under the caret takes the space over the capsule, so the
          // choices fold away rather than stacking a second panel on top.
          open={attaching && completion === undefined}
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
        {/* Closest to the capsule, because the menu belongs to the token under the caret. */}
        {completion === undefined ? null : (
          <SuggestionMenu completion={completion} onAccept={accept} />
        )}
        <html.div style={styles.card}>
          <ContextRow
            head={target.kind === "session" ? target.head : undefined}
            heads={target.kind === "session" ? target.heads : []}
            onChooseHead={chooseHead}
          />
          <TextInput
            ref={fieldRef}
            accessibilityLabel={placeholder}
            value={draft}
            onChangeText={(text) => {
              // The selection event arrives after this one; keeping the caret at
              // the end while typing there means `@` opens its menu on the same
              // keystroke rather than the next.
              setCaret((current) =>
                current >= draft.length ? text.length : Math.min(current, text.length),
              );
              setDraft(text);
            }}
            onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
              setCaret(event.nativeEvent.selection.end);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
    </Animated.View>
  );
});

const styles = css.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    padding: CAPSULE_PAD,
    borderRadius: radii.bubble,
    // The same hairline the panels above it draw, so the capsule and its menus
    // read as one object rather than two weights of edge.
    borderWidth: controls.hairline,
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
    top: -spacing.sm,
    right: -spacing.sm,
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
  insets: (left: number, right: number) => ({
    paddingLeft: left,
    paddingRight: right,
  }),
});
