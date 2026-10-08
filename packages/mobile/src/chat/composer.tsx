import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";
import { Host } from "@expo/ui";
import { Button, HStack, Image, Menu, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  disabled,
  lineLimit,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { randomUUID } from "expo-crypto";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { controls, media, useTheme, radii, spacing, textStyles, tokens } from "../theme.ts";
import { useHost } from "../connection/host-context.tsx";
import {
  type Delivery,
  type ModelInfo,
  type ModelRef,
  type RunConfig,
  type SessionId,
} from "@nyte-ai/protocol";
import { describeHostError } from "../connection/connection.ts";
import { MAX_ATTACHMENTS, type StagedImage } from "../media/attachments.ts";
import {
  chooseSharedPhotos,
  readRecentPhotos,
  requestPhotoAccess,
  stageRecentPhoto,
  type PhotoAccess,
  type RecentPhoto,
} from "../media/recent-photos.ts";
import { clearAnnotation, resolveAttachment } from "../media/annotations.ts";
import { ComposerAttachment } from "./composer-attachment.tsx";
import { useAttachmentFlight } from "./attachment-flight.ts";
import { AttachmentsMenu } from "./attachments-menu.tsx";
import { SuggestionMenu } from "./suggestion-menu.tsx";
import { acceptSuggestion, parseCommandLine, useCompletions } from "./completions.ts";
import type { CommandLine, Suggestion } from "./completions.ts";
import { useModelCatalog } from "./remote-models.ts";
import { ModelPickerSheet } from "./model-selector.tsx";
import { ContextRow } from "./context-row.tsx";
import { usesWorkspaceCursor } from "./workspace-menu.ts";
import {
  readPendingStart,
  recordStart,
  removeStart,
  startParts,
  startText,
  type PendingStart,
} from "./workspace-start.ts";
import {
  PendingStartStrip,
  usePendingStart,
  useRegistryFolders,
  useStartSender,
  workspaceStorage,
} from "./workspace-start.tsx";
import type { UserContent } from "./remote-chat.ts";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";
import { AnimatedGlass } from "./composer-glass.tsx";
import { COMPOSER, SPRING, ICON_ROW_INSET } from "./composer-geometry.ts";
import { GaugeIcon } from "./gauge-icon.tsx";
import { ThinkingSelector } from "./thinking-selector.tsx";
import { clearChatDraft, useChatDraft, useChatScope } from "./drafts.ts";
import {
  discardMessageReceipt,
  finishMessageReceipt,
  finishNewConversation,
  prepareMessageReceipt,
  prepareNewConversation,
  readMessageDelivery,
} from "./send-receipts.ts";
import {
  supportedThinkingLevel,
  THINKING_LABELS,
  thinkingIndex,
  thinkingLevelsFor,
  type ThinkingLevel,
} from "./thinking.ts";

const PHOTO_PAGE = 24;

const MODEL_FONT = { textStyle: "subheadline", weight: "semibold" } as const;

const INPUT_LINE_HEIGHT = 24;

const INPUT_MAX_HEIGHT = INPUT_LINE_HEIGHT * 6;

type NewTarget = { kind: "new" };

type SessionTarget = {
  kind: "session";
  sessionId: SessionId;
  head: string;
  heads: readonly string[];
  config: RunConfig;
  sending: boolean;
  running: boolean;
  stopping: boolean;
  error: string | undefined;
  onSend: (content: UserContent, delivery?: Delivery) => Promise<boolean>;
  onStop: () => void;
};

export const Composer = memo(function Composer({
  target,
  placeholder,
  prefill,
  gutters,
  workspacePending,
  workspaceEpoch = 0,
  onBusyChange,
}: {
  target: NewTarget | SessionTarget;
  placeholder: string;
  prefill?: { text: string; nonce: number };
  gutters: { left: number; right: number };
  workspacePending?: { current: Promise<void> | undefined };
  workspaceEpoch?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const { client, info } = useHost();
  const folders = useRegistryFolders();
  const startSender = useStartSender();
  const pendingStart = usePendingStart();
  const scope = useChatScope();
  const activeSessionId = target.kind === "session" ? target.sessionId : undefined;
  const [draft, setDraft] = useChatDraft(activeSessionId);
  const [caret, setCaret] = useState(prefill?.text.length ?? draft.length);
  const [focused, setFocused] = useState(false);
  const [images, setImages] = useState<StagedImage[]>([]);
  const [attachVisible, setAttachVisible] = useState(false);
  const [access, setAccess] = useState<PhotoAccess>();
  const [staging, setStaging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [model, setModel] = useState<ModelInfo>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [selectingModel, setSelectingModel] = useState(false);
  const [thinking, setThinking] = useState<ThinkingLevel>();
  const [selectorOpen, setSelectorOpen] = useState(false);

  const [delivery, setDelivery] = useState<Delivery>(() =>
    activeSessionId === undefined
      ? "steer"
      : (readMessageDelivery({ scope, sessionId: activeSessionId }) ?? "steer"),
  );

  const { catalog } = useModelCatalog(client);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const fieldRef = useRef<TextInput>(null);
  const selectionOnCommit = useRef<{ draft: string; caret: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const selection = selectionOnCommit.current;
    selectionOnCommit.current = undefined;

    if (selection !== undefined && draft === selection.draft)
      fieldRef.current?.setSelection(selection.caret, selection.caret);
  }, [draft]);
  const keyboard = useReanimatedKeyboardAnimation();
  const thinkingAt = useSharedValue(0);
  const attachProgress = useSharedValue(0);
  const attachExtend = useSharedValue(0);
  const attachmentsHeight = useSharedValue(0);
  const cardHeight = useSharedValue(0);

  const submissionActive = useRef(false);

  const localWorkspacePending = useRef<Promise<void> | undefined>(undefined);

  const { completion, commands } = useCompletions(
    client,
    activeSessionId !== undefined
      ? { kind: "session", sessionId: activeSessionId }
      : folders === undefined
        ? { kind: "cursor" }
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

  const seenPrefill = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prefill === undefined || prefill.nonce === seenPrefill.current) return;
    seenPrefill.current = prefill.nonce;
    setDraft(prefill.text);
    setCaret(prefill.text.length);
  }, [prefill, setDraft]);

  const sending = target.kind === "session" ? target.sending : starting;
  const running = target.kind === "session" ? target.running : false;
  const stopping = target.kind === "session" ? target.stopping : false;

  const error =
    localError ?? dictation.error ?? (target.kind === "session" ? target.error : undefined);

  const hasContent = draft.trim() !== "" || images.length > 0;
  const sessionModel = target.kind === "session" ? target.config.model : undefined;
  const sessionThinking = target.kind === "session" ? target.config.thinkingLevel : undefined;

  const catalogModel = matchCatalogModel(
    catalog.kind === "ready" ? catalog.models : [],
    sessionModel,
  );

  const chosenModel =
    model ?? catalogModel ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);

  const thinkingStops = thinkingLevelsFor(chosenModel);
  const chosenThinking = supportedThinkingLevel(chosenModel, thinking ?? sessionThinking);
  const canThink = thinkingStops.length > 1;

  if (selectorOpen && !canThink) setSelectorOpen(false);

  const busy = sending || staging || selectingModel;
  const attachDisabled = busy || images.length >= MAX_ATTACHMENTS;

  const expanded = focused || modelPickerOpen || selectorOpen || dictation.recording;

  const cardDock = useDerivedValue(() => {
    const lifted = -keyboard.height.get();
    const pad = insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get();

    return lifted + pad + spacing.xs + COMPOSER.height / 2 - ICON_ROW_INSET;
  });

  const flight = useAttachmentFlight({
    close: () => setAttachVisible(false),
    cardDock,
    cardHeight,
    windowHeight,
    cardLeft: gutters.left,
  });

  const plusLeft = useDerivedValue(() => gutters.left + 2);

  const catalogModelKey =
    catalogModel === undefined ? undefined : `${catalogModel.provider}:${catalogModel.id}`;

  const [seenModelKey, setSeenModelKey] = useState(catalogModelKey);

  if (seenModelKey !== catalogModelKey) {
    setSeenModelKey(catalogModelKey);

    if (catalogModel !== undefined) setModel(catalogModel);
  }

  const [seenThinking, setSeenThinking] = useState(sessionThinking);

  if (seenThinking !== sessionThinking) {
    setSeenThinking(sessionThinking);

    if (sessionThinking !== undefined) setThinking(sessionThinking);
  }

  useEffect(() => {
    if (selectorOpen) return;
    thinkingAt.set(thinkingIndex(thinkingLevelsFor(chosenModel), chosenThinking));
  }, [chosenThinking, chosenModel, selectorOpen, thinkingAt]);

  const completionOpen = completion !== undefined;
  useEffect(() => {
    if (!completionOpen) return;
    attachExtend.set(withSpring(0, SPRING.open));
    attachProgress.set(
      withSpring(0, SPRING.open, (finished) => {
        "worklet";

        if (finished) {
          attachExtend.set(0);
          scheduleOnRN(setAttachVisible, false);
        }
      }),
    );
  }, [completionOpen, attachExtend, attachProgress]);

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

  const configureSession = async (
    sessionId: SessionId,
    next: {
      model?: ModelInfo;
      thinkingLevel?: ThinkingLevel;
    },
  ): Promise<boolean> => {
    try {
      const request = { sessionId };

      const withModel =
        next.model === undefined
          ? request
          : { ...request, model: { provider: next.model.provider, id: next.model.id } };

      const outcome = await client.sessions.configure(
        next.thinkingLevel === undefined
          ? withModel
          : { ...withModel, thinkingLevel: next.thinkingLevel },
      );

      switch (outcome.kind) {
        case "queued":
          return true;
        case "unknown_model":
          setLocalError("The host doesn't offer that model.");

          return false;
        case "unknown_agent":
          setLocalError("The host doesn't offer that agent.");

          return false;
        default: {
          const exhaustive: never = outcome;

          return exhaustive;
        }
      }
    } catch (cause: unknown) {
      setLocalError(describeHostError(cause));

      return false;
    }
  };

  const submit = async () => {
    if (submissionActive.current || busy || !hasContent || dictation.recording) return;
    submissionActive.current = true;
    const submitted = draft;
    const submittedImages = images;
    const content = buildContent();
    const line = images.length === 0 ? parseCommandLine(draft, commands) : undefined;
    setNotice(undefined);
    setLocalError(undefined);

    try {
      if (target.kind === "session") {
        const send = (message: UserContent) => {
          const receipt = prepareMessageReceipt({
            scope,
            sessionId: target.sessionId,
            content: message,
            delivery: running ? delivery : undefined,
            draft: submitted,
          });

          return target.onSend(message, receipt.delivery);
        };

        if (await deliver({ sessionId: target.sessionId, content, line, send }))
          clearSubmitted(submitted, submittedImages);

        return;
      }

      setStarting(true);
      onBusyChange?.(true);

      if (folders !== undefined) {
        const folder = folders.kind === "ready" ? folders.selected : undefined;

        if (folder === undefined) {
          setLocalError(
            folders.kind === "ready" ? "Choose a folder first." : "Folders are still loading.",
          );

          return;
        }

        if (readPendingStart(workspaceStorage, scope) !== undefined) {
          setLocalError("Finish the waiting message first.");

          return;
        }

        const typed = submitted.trim().split("\n")[0]?.slice(0, 48) ?? "";

        const request = {
          requestId: randomUUID(),
          workspace: { id: folder.id },
          message: { content },
          name: typed === "" ? "New conversation" : typed,
        };

        const withModel =
          model === undefined
            ? request
            : { ...request, model: { provider: model.provider, id: model.id } };

        // The whole request is on record before it is sent; every retry sends the record.
        const recorded = recordStart(
          workspaceStorage,
          scope,
          thinking === undefined ? withModel : { ...withModel, thinkingLevel: thinking },
        );

        if (recorded.kind === "waiting") {
          setLocalError("Finish the waiting message first.");

          return;
        }

        clearSubmitted(submitted, submittedImages);
        void startSender.send(recorded.pending.input, true).then((failure) => {
          if (failure !== undefined) setLocalError(failure);
        });

        return;
      }

      await (workspacePending ?? localWorkspacePending).current;

      const selection = usesWorkspaceCursor(info) ? await client.workspace.current() : undefined;

      const workspace = selection?.kind === "project" ? selection.workspace.path : "home";
      const id = prepareNewConversation({ scope, workspace });
      const typed = draft.trim().split("\n")[0]?.slice(0, 48) ?? "";
      const name = line?.name ?? (typed === "" ? "New conversation" : typed);
      const existing = await client.sessions.get({ sessionId: id });
      const session = existing ?? (await client.sessions.create({ sessionId: id, name }));

      if (
        (model !== undefined || thinking !== undefined) &&
        !(await configureSession(session.sessionId, { model, thinkingLevel: thinking }))
      )
        return;

      const accepted = await deliver({
        sessionId: session.sessionId,
        content,
        line,
        send: async (message) => {
          const receipt = prepareMessageReceipt({
            scope,
            sessionId: session.sessionId,
            content: message,
            draft: submitted,
          });

          await client.messages.send({
            sessionId: session.sessionId,
            content: message,
            delivery: receipt.delivery,
            key: receipt.key,
          });
          clearChatDraft({ scope, submitted });
          finishMessageReceipt({ scope, sessionId: session.sessionId, key: receipt.key });

          return true;
        },
      });

      if (!accepted) return;
      clearSubmitted(submitted, submittedImages);
      finishNewConversation({ scope, id });
      Keyboard.dismiss();
      router.push(`/chat/${session.sessionId}`);
    } catch (cause: unknown) {
      setLocalError(describeHostError(cause));
    } finally {
      submissionActive.current = false;
      setStarting(false);

      if (target.kind === "new") onBusyChange?.(false);
    }
  };

  /** A waiting start goes back into the composer, ahead of anything typed since. */
  const editStart = (pending: PendingStart) => {
    const restored = startParts(pending.input).flatMap((part): StagedImage[] =>
      part.type === "image"
        ? [
            {
              id: randomUUID(),
              uri: `data:${part.mimeType};base64,${part.data}`,
              image: part,
            },
          ]
        : [],
    );

    if (images.length + restored.length > MAX_ATTACHMENTS) {
      setLocalError("Remove a photo first.");

      return;
    }

    const text = startText(pending.input);
    setDraft((current) => (current.trim() === "" ? text : `${text}\n\n${current}`));
    setImages((current) => [...restored, ...current]);
    removeStart(workspaceStorage, scope, pending.input.requestId);
    setLocalError(undefined);
  };

  const accept = (suggestion: Suggestion) => {
    if (completion === undefined) return;
    const next = acceptSuggestion(draft, completion.trigger, suggestion);
    selectionOnCommit.current = next;
    setDraft(next.draft);
    setCaret(next.caret);
  };

  const loadPhotos = () => {
    return readRecentPhotos(PHOTO_PAGE)
      .then(setAccess)
      .catch(() => setAccess({ kind: "denied" }));
  };

  const closeAttach = () => {
    attachExtend.set(withSpring(0, SPRING.open));
    attachProgress.set(
      withSpring(0, SPRING.open, (finished) => {
        "worklet";

        if (finished) {
          attachExtend.set(0);
          scheduleOnRN(setAttachVisible, false);
        }
      }),
    );
  };

  const closeSelector = () => {
    setSelectorOpen(false);
  };

  const openAttach = () => {
    if (attachDisabled) return;

    if (selectorOpen) closeSelector();
    flight.reset();
    attachExtend.set(0);
    attachProgress.set(0);
    setAttachVisible(true);
    setLocalError(undefined);
  };

  const openSelector = () => {
    if (!canThink || busy) return;

    if (attachVisible) closeAttach();
    Keyboard.dismiss();
    setSelectorOpen(true);
  };

  const preparePhotos = async (photos: readonly RecentPhoto[]): Promise<readonly StagedImage[]> => {
    if (busy || images.length >= MAX_ATTACHMENTS) return [];
    setStaging(true);

    if (target.kind === "new") onBusyChange?.(true);
    setLocalError(undefined);

    try {
      return await Promise.all(
        photos.slice(0, MAX_ATTACHMENTS - images.length).map(stageRecentPhoto),
      );
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Couldn't attach photo.");
      throw cause;
    } finally {
      setStaging(false);

      if (target.kind === "new") onBusyChange?.(false);
    }
  };

  const chooseHead = (head: string) => {
    if (target.kind !== "session") return;
    void client.sessions
      .configure({ sessionId: target.sessionId, head })
      .catch((cause: unknown) => setLocalError(describeHostError(cause)));
  };

  const chooseModel = async (choice: ModelInfo): Promise<boolean> => {
    if (busy) return false;

    setModel(choice);

    if (selectorOpen) closeSelector();

    if (target.kind !== "session") return true;

    setSelectingModel(true);

    const applied = await configureSession(target.sessionId, {
      model: choice,
      thinkingLevel: supportedThinkingLevel(choice, chosenThinking),
    });

    setSelectingModel(false);

    if (!applied) {
      setModel(catalogModel);
      setThinking(sessionThinking);
    }

    return applied;
  };

  const chooseThinking = (choice: ThinkingLevel) => {
    setThinking(choice);

    if (target.kind !== "session") return;
    void configureSession(target.sessionId, { thinkingLevel: choice }).then((applied) => {
      if (!applied) setThinking(sessionThinking);
    });
  };

  const startDictation = async () => {
    dictationBase.current = draft.trimEnd();
    await dictation.start();
  };

  const keyboardInset = useAnimatedStyle(() => ({
    paddingBottom: insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get(),
  }));

  const attachmentStripStyle = useAnimatedStyle(() => ({ height: attachmentsHeight.get() }));

  const composerCornerStyle = useAnimatedStyle(() => ({
    borderRadius: expanded
      ? 28
      : interpolate(attachmentsHeight.get(), [0, 24], [999, 28], Extrapolation.CLAMP),
  }));

  const triggerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(attachVisible ? 0 : 1),
    transform: [
      { scale: withTiming(attachVisible ? 1.6 : 1) },
      { translateX: withTiming(attachVisible ? 12 : 0) },
      { translateY: withTiming(attachVisible ? -12 : 0) },
    ],
  }));

  return (
    <Animated.View style={keyboardInset}>
      <html.div style={[styles.composer, styles.insets(gutters.left, gutters.right)]}>
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
        {target.kind === "new" && folders !== undefined && pendingStart !== undefined ? (
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
            cardHeight={cardHeight}
            cardDock={cardDock}
          />
        )}
        <View onLayout={(event) => cardHeight.set(event.nativeEvent.layout.height)}>
          <AnimatedGlass
            isInteractive
            style={[field.card, composerCornerStyle, expanded && field.expandedCard]}
          >
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
                style={
                  images.length === 0
                    ? undefined
                    : {
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 10,
                        paddingHorizontal: 14,
                        paddingTop: 14,
                        paddingBottom: 12,
                      }
                }
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
                    onRemove={() => {
                      clearAnnotation(image.id);
                      setImages((current) => current.filter((item) => item.id !== image.id));
                    }}
                  />
                ))}
              </View>
            </Animated.View>

            {expanded && target.kind === "session" && target.heads.length > 1 ? (
              <html.div style={styles.context}>
                <ContextRow head={target.head} heads={target.heads} onChooseHead={chooseHead} />
              </html.div>
            ) : null}
            {running ? (
              <html.div style={[styles.deliveryRow, delivery === "next" && styles.queuedDelivery]}>
                <Host
                  style={field.deliveryHost}
                  matchContents={{ vertical: true }}
                  ignoreSafeArea="all"
                >
                  <Menu
                    label={
                      <HStack spacing={spacing.xs}>
                        <Image
                          systemName={delivery === "next" ? "clock" : "arrow.turn.up.right"}
                          size={14}
                          modifiers={[foregroundStyle(theme.accent)]}
                        />
                        <Text
                          modifiers={[
                            font(MODEL_FONT),
                            foregroundStyle(theme.accent),
                            lineLimit(1),
                          ]}
                        >
                          {delivery === "next" ? "After this response" : "Steer response"}
                        </Text>
                        <Image
                          systemName="chevron.down"
                          size={10}
                          modifiers={[foregroundStyle(theme.accent)]}
                        />
                      </HStack>
                    }
                    modifiers={[
                      buttonStyle("plain"),
                      frame({ minHeight: controls.touchTarget }),
                      disabled(busy),
                    ]}
                  >
                    <Button
                      label="Steer current response"
                      systemImage={delivery === "steer" ? "checkmark" : undefined}
                      onPress={() => {
                        setDelivery("steer");

                        if (target.kind === "session")
                          discardMessageReceipt({ scope, sessionId: target.sessionId });
                      }}
                    />
                    <Button
                      label="Queue after response"
                      systemImage={delivery === "next" ? "checkmark" : undefined}
                      onPress={() => {
                        setDelivery("next");

                        if (target.kind === "session")
                          discardMessageReceipt({ scope, sessionId: target.sessionId });
                      }}
                    />
                  </Menu>
                </Host>
                <html.button
                  aria-label="Stop response"
                  aria-busy={stopping}
                  disabled={stopping}
                  onClick={() => {
                    if (target.kind === "session") target.onStop();
                  }}
                  style={styles.stop}
                >
                  {stopping ? (
                    <ActivityIndicator color={theme.muted} size="small" />
                  ) : (
                    <SymbolView name="stop.fill" size={16} tintColor={theme.foreground} />
                  )}
                </html.button>
              </html.div>
            ) : null}
            <View
              style={[
                field.inputArea,
                expanded ? field.expandedInputArea : field.collapsedInputArea,
              ]}
            >
              <TextInput
                ref={fieldRef}
                style={[
                  field.input,
                  {
                    maxHeight: expanded ? INPUT_MAX_HEIGHT : INPUT_LINE_HEIGHT * 2,
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
                onSelectionChange={(
                  event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
                ) => {
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
            <View
              pointerEvents="box-none"
              style={[field.actions, !expanded && field.collapsedActions]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add attachment"
                accessibilityState={{ disabled: attachDisabled, expanded: attachVisible }}
                disabled={attachDisabled}
                onPress={attachVisible ? closeAttach : openAttach}
                style={[field.plusHit, attachDisabled && field.disabled]}
              >
                <Animated.View style={triggerStyle}>
                  <SymbolView name="plus" size={22} tintColor={theme.foreground} weight="regular" />
                </Animated.View>
              </Pressable>
              {expanded && !dictation.recording ? (
                <Host
                  style={field.modelHost}
                  matchContents={{ vertical: true }}
                  ignoreSafeArea="all"
                >
                  <Button
                    onPress={() => {
                      Keyboard.dismiss();
                      setLocalError(undefined);
                      setModelPickerOpen(true);
                    }}
                    modifiers={[
                      buttonStyle("plain"),
                      disabled(busy),
                      accessibilityLabel(`Choose model, ${chosenModel?.name ?? "Model"}`),
                    ]}
                  >
                    <HStack
                      spacing={spacing.xs}
                      modifiers={[
                        frame({ minHeight: controls.touchTarget, maxWidth: Infinity }),
                        contentShape(shapes.rectangle()),
                      ]}
                    >
                      <Text
                        modifiers={[
                          font(MODEL_FONT),
                          foregroundStyle(theme.foreground),
                          lineLimit(1),
                        ]}
                      >
                        {chosenModel?.name ?? "Choose model"}
                      </Text>
                      <Image
                        systemName="chevron.down"
                        size={12}
                        modifiers={[foregroundStyle(theme.foreground)]}
                      />
                    </HStack>
                  </Button>
                </Host>
              ) : (
                <View style={field.spacer} pointerEvents="none" />
              )}
              {expanded && canThink && !dictation.recording ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Thinking level"
                  accessibilityValue={{ text: THINKING_LABELS[chosenThinking] }}
                  accessibilityState={{ expanded: selectorOpen, disabled: busy }}
                  disabled={busy}
                  onPress={openSelector}
                  style={[field.plusHit, busy && field.disabled]}
                >
                  {selectorOpen ? null : (
                    <GaugeIcon
                      level={thinkingAt}
                      stopCount={thinkingStops.length}
                      accent={theme.accent}
                      track={theme.muted}
                      needle={theme.foreground}
                    />
                  )}
                </Pressable>
              ) : null}
              {dictation.recording ? (
                <html.button
                  aria-label="Stop dictation"
                  onClick={dictation.stop}
                  style={styles.primary}
                >
                  <SymbolView name="stop.circle.fill" size={28} tintColor={theme.accent} />
                </html.button>
              ) : hasContent ? (
                <html.button
                  aria-label={
                    running && delivery === "next"
                      ? "Queue message"
                      : running
                        ? "Steer response"
                        : "Send message"
                  }
                  aria-busy={sending}
                  disabled={busy}
                  onClick={() => void submit()}
                  style={styles.primary}
                >
                  <html.div style={styles.send}>
                    {sending ? (
                      <ActivityIndicator color={theme.onAccentFill} size="small" />
                    ) : (
                      <SymbolView
                        name="arrow.up"
                        size={19}
                        tintColor={theme.onAccentFill}
                        weight="semibold"
                      />
                    )}
                  </html.div>
                </html.button>
              ) : (
                <html.button
                  aria-label="Dictate"
                  disabled={busy}
                  onClick={() => void startDictation()}
                  style={styles.primary}
                >
                  <SymbolView name="mic.fill" size={22} tintColor={theme.muted} />
                </html.button>
              )}
            </View>
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
          </AnimatedGlass>
        </View>
      </html.div>
      <ModelPickerSheet
        client={client}
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        selectedModel={chosenModel}
        selectingModel={selectingModel}
        modelError={localError}
        onSelect={chooseModel}
      />
      <ThinkingSelector
        open={selectorOpen && canThink}
        level={thinkingAt}
        initialIndex={thinkingIndex(thinkingStops, chosenThinking)}
        levels={thinkingStops}
        modelName={chosenModel?.name ?? "Model"}
        onClose={closeSelector}
        onCommit={(index) => {
          const next = thinkingStops[index];

          if (next !== undefined) chooseThinking(next);
        }}
      />
      {attachVisible ? (
        <AttachmentsMenu
          progress={attachProgress}
          extendProgress={attachExtend}
          cardDock={cardDock}
          plusLeft={plusLeft}
          access={access}
          disabled={attachDisabled}
          onClose={closeAttach}
          flight={flight}
          remaining={MAX_ATTACHMENTS - images.length}
          onPreparePhotos={preparePhotos}
          onCommitPhotos={(prepared) =>
            setImages((current) => [...current, ...prepared].slice(0, MAX_ATTACHMENTS))
          }
          onRequestPhotos={async () => {
            setAccess(await requestPhotoAccess(PHOTO_PAGE));
          }}
          onReadPhotos={loadPhotos}
          onManageAccess={async () => {
            await chooseSharedPhotos();
            await loadPhotos();
          }}
          onCapture={(image) => {
            setImages((current) => [...current, image].slice(0, MAX_ATTACHMENTS));
            closeAttach();
          }}
        />
      ) : null}
    </Animated.View>
  );
});

function matchCatalogModel(
  models: readonly ModelInfo[],
  ref: ModelRef | undefined,
): ModelInfo | undefined {
  if (ref === undefined) return undefined;

  return models.find(
    (item) => item.id === ref.id && (ref.provider === undefined || item.provider === ref.provider),
  );
}

const field = StyleSheet.create({
  card: { borderCurve: "continuous", borderRadius: 24, minWidth: 0, overflow: "hidden" },
  expandedCard: { borderRadius: 28 },
  plusHit: {
    width: controls.touchTarget,
    height: controls.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  inputArea: { minHeight: COMPOSER.height, justifyContent: "center", paddingVertical: spacing.md },
  collapsedInputArea: { paddingHorizontal: controls.touchTarget + spacing.sm },
  expandedInputArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: 2,
    paddingBottom: 2,
    minHeight: controls.touchTarget + 2,
  },
  collapsedActions: { position: "absolute", left: 0, right: 0, bottom: 0 },
  spacer: { flex: 1 },
  modelHost: { flex: 1, minHeight: controls.touchTarget, minWidth: 0 },
  deliveryHost: { flex: 1, minHeight: controls.touchTarget, minWidth: 0 },
  disabled: { opacity: controls.disabledOpacity },
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
  context: { paddingInline: spacing.md },
  primary: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    width: controls.touchTarget,
    height: controls.touchTarget,
    borderWidth: 0,
    padding: 0,
    opacity: {
      default: 1,
      ":active": controls.pressedOpacity,
      ":disabled": controls.disabledOpacity,
    },
  },
  send: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: tokens.accentFill,
  },
  deliveryRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    marginInline: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.sm,
    borderBottomWidth: controls.hairline,
    borderBottomColor: tokens.border,
  },
  queuedDelivery: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.accent,
    borderRadius: radii.control,
  },
  stop: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: controls.touchTarget,
    height: controls.touchTarget,
    borderWidth: 0,
    padding: 0,
    opacity: {
      default: 1,
      ":active": controls.pressedOpacity,
      ":disabled": controls.disabledOpacity,
    },
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
  attachment: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  attachmentButton: {
    borderWidth: 0,
    padding: 0,
    width: media.attachmentSize,
    height: media.attachmentSize,
  },
  attachmentImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: radii.control,
  },
  removePhoto: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
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
  insets: (left: number, right: number) => ({
    paddingLeft: left,
    paddingRight: right,
  }),
});
