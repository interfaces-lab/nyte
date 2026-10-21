import { memo, useLayoutEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { TextInputInstance } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Delivery } from "@nyte-ai/sdk";
import { controls, spacing, textStyles, useTheme } from "../theme.ts";
import { useHost } from "../connection/host-context.tsx";
import { MAX_ATTACHMENTS } from "../media/attachments.ts";
import { ComposerAttachment } from "./composer-attachment.tsx";
import { AttachmentsMenu } from "./attachments-menu.tsx";
import { SuggestionMenu } from "./suggestion-menu.tsx";
import { acceptSuggestion, useCompletions } from "./completions.ts";
import type { Suggestion } from "./completions.ts";
import { ModelPickerSheet } from "./model-selector.tsx";
import { PendingStartStrip, usePendingStart, useRegistryFolders } from "./workspace-start.tsx";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";
import { AnimatedGlass } from "./composer-glass.tsx";
import { COMPOSER, ICON_ROW_INSET } from "./composer-geometry.ts";
import { useChatDraft } from "./drafts.ts";
import type { ComposerTarget } from "./composer-target.ts";
import { ComposerControls } from "./composer-controls.tsx";
import { ComposerActions } from "./composer-actions.tsx";
import { useComposerModel } from "./use-composer-model.ts";
import { useComposerAttachments } from "./use-composer-attachments.ts";
import { useComposerSubmit } from "./use-composer-submit.ts";

const INPUT_LINE_HEIGHT = 24;

const INPUT_MAX_LINES = 6;

/**
 * The message composer docked above the keyboard, for a new conversation or a session follow-up. It owns
 * the draft, caret, and focus; the model, attachments, and submission each live in their own hook, and
 * the controls above the card and the action row inside it are their own components.
 */
export const Composer = memo(function Composer({
  target,
  placeholder,
  gutters,
  workspaceEpoch = 0,
  onBusyChange,
}: {
  target: ComposerTarget;
  placeholder: string;
  gutters: { left: number; right: number };
  workspaceEpoch?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const { client } = useHost();
  const folders = useRegistryFolders();
  const pendingStart = usePendingStart();
  const [draft, setDraft] = useChatDraft(target.kind === "session" ? target.sessionId : undefined);
  const [caret, setCaret] = useState(draft.length);
  const [focused, setFocused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [delivery, setDelivery] = useState<Delivery>("steer");
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const inputLineHeight = INPUT_LINE_HEIGHT * fontScale;
  const fieldRef = useRef<TextInputInstance>(null);
  const selectionOnCommit = useRef<{ draft: string; caret: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const selection = selectionOnCommit.current;
    selectionOnCommit.current = undefined;

    if (selection !== undefined && draft === selection.draft)
      fieldRef.current?.setSelection(selection.caret, selection.caret);
  }, [draft]);
  const keyboard = useReanimatedKeyboardAnimation();
  const attachmentsHeight = useSharedValue(0);
  const cardHeight = useSharedValue(0);
  const topControlsHeight = useSharedValue(0);

  const { completion, commands } = useCompletions(
    client,
    target.kind === "session"
      ? { kind: "session", workspace: target.workspace, catalog: target.catalog }
      : { kind: "registered", id: folders.kind === "ready" ? folders.selected?.id : undefined },
    draft,
    caret,
    focused,
    workspaceEpoch,
  );

  const dictationBase = useRef("");

  const dictation = useDictation((transcript) => {
    const base = dictationBase.current;
    setDraft(base === "" || transcript === "" ? base + transcript : `${base} ${transcript}`);
  });

  const model = useComposerModel(client, target, setLocalError);
  const sending = target.kind === "session" ? target.sending : starting;
  const running = target.kind === "session" && target.running;

  const cardDock = useDerivedValue(() => {
    const lifted = -keyboard.height.get();
    const pad = insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get();

    return lifted + pad + spacing.xs + COMPOSER.height / 2 - ICON_ROW_INSET;
  });

  const attachments = useComposerAttachments({
    blocked: sending || model.selecting,
    suggesting: completion !== undefined,
    geometry: { cardDock, cardHeight, windowHeight, cardLeft: gutters.left },
    reportError: setLocalError,
    onStaging: target.kind === "new" ? onBusyChange : undefined,
  });

  const { images, flight } = attachments;
  const busy = sending || model.selecting || attachments.staging;
  const hasContent = draft.trim() !== "" || images.length > 0;

  const { notice, submit, editStart } = useComposerSubmit({
    client,
    target,
    folders,
    draft,
    setDraft,
    attachments,
    commands,
    delivery,
    start: model.start,
    setStarting,
    onBusyChange,
    reportError: setLocalError,
  });

  const error =
    localError ?? dictation.error ?? (target.kind === "session" ? target.error : undefined);

  const menuObstructionHeight = useDerivedValue(
    () => cardHeight.get() + topControlsHeight.get() + spacing.xs,
  );

  const plusLeft = useDerivedValue(() => gutters.left + 2);

  const accept = (suggestion: Suggestion) => {
    if (completion === undefined) return;
    const next = acceptSuggestion(draft, completion.trigger, suggestion);
    selectionOnCommit.current = next;
    setDraft(next.draft);
    setCaret(next.caret);
  };

  const keyboardInset = useAnimatedStyle(() => ({
    paddingBottom: insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get(),
  }));

  const attachmentStripStyle = useAnimatedStyle(() => ({ height: attachmentsHeight.get() }));

  return (
    <Animated.View style={keyboardInset}>
      <html.div style={[styles.composer, styles.insets(gutters.left, gutters.right)]}>
        {attachments.staging ? (
          <html.div style={styles.attachmentStatus} aria-live="polite">
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Preparing photo…</html.span>
          </html.div>
        ) : attachments.remaining <= 0 ? (
          <html.p style={textStyles.caption}>
            {`Up to ${String(MAX_ATTACHMENTS)} photos per message.`}
          </html.p>
        ) : null}
        {target.kind === "new" && pendingStart !== undefined ? (
          <PendingStartStrip
            key={pendingStart.input.requestId}
            pending={pendingStart}
            onEdit={editStart}
          />
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
        {completion === undefined ? null : (
          <SuggestionMenu
            completion={completion}
            onAccept={accept}
            cardHeight={menuObstructionHeight}
            cardDock={cardDock}
          />
        )}
        <ComposerControls
          target={target}
          expanded={focused || modelPickerOpen || dictation.recording}
          recording={dictation.recording}
          busy={busy}
          delivery={delivery}
          onDelivery={setDelivery}
          model={model}
          onOpenModelPicker={() => {
            setLocalError(undefined);
            setModelPickerOpen(true);
          }}
          onHeight={(height) => topControlsHeight.set(height)}
        />
        <View onLayout={(event) => cardHeight.set(event.nativeEvent.layout.height)}>
          <AnimatedGlass isInteractive style={field.card}>
            <Animated.View style={[{ overflow: "hidden" }, attachmentStripStyle]}>
              <View
                onLayout={(event) => {
                  const next = event.nativeEvent.layout.height;
                  attachmentsHeight.set(
                    flight.pendingId === undefined
                      ? withTiming(next, { duration: 340, easing: Easing.out(Easing.cubic) })
                      : next,
                  );
                }}
                style={images.length === 0 ? undefined : field.attachments}
              >
                {images.map((image, index) => (
                  <ComposerAttachment
                    key={image.id}
                    image={image}
                    index={index}
                    flight={flight}
                    disabled={sending}
                    onAnnotate={() =>
                      router.push(
                        `/annotate?imageId=${encodeURIComponent(image.id)}&uri=${encodeURIComponent(image.uri)}`,
                      )
                    }
                    onRemove={() => attachments.remove(image.id)}
                  />
                ))}
              </View>
            </Animated.View>

            {dictation.recording ? (
              <html.div style={styles.recording} role="status">
                <html.span style={[textStyles.caption, styles.recorderTime]}>
                  {formatElapsed(dictation.elapsed)}
                </html.span>
                <View style={field.waveform} pointerEvents="none">
                  {dictation.levels.map((sample, index) => (
                    <View
                      key={index}
                      style={[
                        field.waveBar,
                        { height: waveHeight(sample), backgroundColor: theme.accent },
                      ]}
                    />
                  ))}
                </View>
              </html.div>
            ) : null}
            <View style={field.inputArea}>
              <TextInput
                ref={fieldRef}
                style={[
                  field.input,
                  {
                    minHeight: inputLineHeight,
                    maxHeight: inputLineHeight * INPUT_MAX_LINES,
                    color: dictation.recording ? theme.accent : theme.foreground,
                  },
                ]}
                value={draft}
                onChangeText={(text) => {
                  setCaret((current) =>
                    current >= draft.length ? text.length : Math.min(current, text.length),
                  );
                  setDraft(text);
                }}
                onSelectionChange={(event) => {
                  setCaret(event.nativeEvent.selection.end);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={placeholder}
                placeholderTextColor={theme.muted}
                selectionColor={theme.accent}
                editable={(target.kind === "session" || !sending) && !dictation.recording}
                multiline
                submitBehavior="newline"
                returnKeyType="default"
                keyboardAppearance={dark ? "dark" : "light"}
                accessibilityLabel={placeholder}
              />
            </View>
            <ComposerActions
              attachOpen={attachments.visible}
              attachDisabled={attachments.disabled}
              onToggleAttach={attachments.visible ? attachments.close : attachments.open}
              recording={dictation.recording}
              onStopDictation={dictation.stop}
              onDictate={() => {
                dictationBase.current = draft.trimEnd();
                void dictation.start();
              }}
              hasContent={hasContent}
              sendLabel={
                running && delivery === "queue"
                  ? "Queue message"
                  : running
                    ? "Steer response"
                    : "Send message"
              }
              sending={sending}
              busy={busy}
              onSend={() => {
                if (!busy) submit();
              }}
            />
          </AnimatedGlass>
        </View>
      </html.div>
      <ModelPickerSheet
        client={client}
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        selectedModel={model.chosenModel?.ref}
        selectingModel={model.selecting}
        modelError={localError}
        onSelect={async (choice) => (busy ? false : model.chooseModel(choice))}
      />
      {attachments.visible ? (
        <AttachmentsMenu
          progress={attachments.progress}
          extendProgress={attachments.extend}
          cardDock={cardDock}
          plusLeft={plusLeft}
          access={attachments.access}
          disabled={attachments.disabled}
          onClose={attachments.close}
          flight={flight}
          remaining={attachments.remaining}
          onPreparePhotos={attachments.prepare}
          onCommitPhotos={attachments.add}
          onRequestPhotos={attachments.requestPhotos}
          onReadPhotos={attachments.loadPhotos}
          onManageAccess={attachments.manageAccess}
          onCapture={(image) => {
            attachments.add([image]);
            attachments.close();
          }}
        />
      ) : null}
    </Animated.View>
  );
});

const field = StyleSheet.create({
  card: {
    borderCurve: "continuous",
    borderRadius: COMPOSER.height / 2,
    minWidth: 0,
    overflow: "hidden",
  },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  inputArea: {
    minHeight: COMPOSER.height,
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: controls.touchTarget + spacing.sm,
  },
  input: {
    minWidth: 0,
    minHeight: INPUT_LINE_HEIGHT,
    fontSize: COMPOSER.fontSize,
    lineHeight: INPUT_LINE_HEIGHT,
    padding: 0,
    textAlignVertical: "top",
    alignSelf: "stretch",
  },
  waveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 20,
    overflow: "hidden",
  },
  waveBar: { width: 3, borderRadius: 2 },
});

const styles = css.create({
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  recording: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingInline: spacing.lg,
    paddingBottom: spacing.sm,
  },
  recorderTime: { fontVariantNumeric: "tabular-nums" },
  attachmentStatus: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  insets: (left: number, right: number) => ({
    paddingLeft: left,
    paddingRight: right,
  }),
});
