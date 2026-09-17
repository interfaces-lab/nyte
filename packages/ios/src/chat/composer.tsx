import { memo, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";
import { Button, Host, Menu, Text } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  menuIndicator,
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
import type { ModelInfo, ModelRef, RunConfig, SessionId } from "@nyte-ai/protocol";
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
import { AttachmentsMenu } from "./attachments-menu.tsx";
import { SuggestionMenu } from "./suggestion-menu.tsx";
import { acceptSuggestion, parseCommandLine, useCompletions } from "./completions.ts";
import type { CommandLine, Suggestion } from "./completions.ts";
import { useModelCatalog } from "./remote-models.ts";
import { ContextRow } from "./context-row.tsx";
import { WorkspacePicker } from "./workspace-menu.tsx";
import type { UserContent } from "./remote-chat.ts";
import { formatElapsed, useDictation, waveHeight } from "./dictation.ts";
import { AnimatedGlass, HAS_GLASS } from "./composer-glass.tsx";
import { COMPOSER, ICON_ROW_BOTTOM, SELECTOR, SPRING } from "./composer-geometry.ts";
import { GaugeIcon } from "./gauge-icon.tsx";
import {
  supportedThinkingLevel,
  thinkingIndex,
  thinkingLevelsFor,
  type ThinkingLevel,
} from "./thinking.ts";
import { ThinkingSelector } from "./thinking-selector.tsx";

const PHOTO_PAGE = 24;
const MODEL_FONT = { size: typography.caption.fontSize, weight: "medium" } as const;
const modelHost = { height: COMPOSER.hit } as const;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

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
  onSend: (content: UserContent) => Promise<boolean>;
  onStop: () => void;
};

/**
 * The one composer, on the list and in a conversation. Resting it is a single
 * glass pill. Focus grows it into a two-row card: the prompt lifts, and the
 * model menu plus thinking gauge appear in the icon row. The gauge morphs into
 * the host's thinking-level slider without dismissing the keyboard. Plus morphs
 * into Camera / Photos, then a library grid or live camera, over the keyboard.
 * A new chat shows a workspace chip above the glass; a follow-up does not.
 */
export const Composer = memo(function Composer({
  target,
  placeholder,
  prefill,
  backdrop,
  gutters,
  onWorkspaceChange,
}: {
  target: NewTarget | SessionTarget;
  placeholder: string;
  prefill?: { text: string; nonce: number };
  /** What the screen behind the bar paints, so a non-glass bar matches it. */
  backdrop: "background" | "canvas";
  gutters: { left: number; right: number };
  onWorkspaceChange?: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const { client } = useHost();
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [images, setImages] = useState<StagedImage[]>([]);
  const [attachVisible, setAttachVisible] = useState(false);
  const [access, setAccess] = useState<PhotoAccess>();
  const [staging, setStaging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [model, setModel] = useState<ModelInfo>();
  const [thinking, setThinking] = useState<ThinkingLevel>();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const { catalog } = useModelCatalog(client, true);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const fieldRef = useRef<TextInput>(null);
  const keyboard = useReanimatedKeyboardAnimation();
  const focusDrive = useSharedValue(0);
  const selector = useSharedValue(0);
  const opening = useSharedValue(false);
  const thinkingAt = useSharedValue(0);
  const attachProgress = useSharedValue(0);
  const attachExtend = useSharedValue(0);
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
  const sessionModel = target.kind === "session" ? target.config.model : undefined;
  const sessionThinking = target.kind === "session" ? target.config.thinkingLevel : undefined;
  const catalogModel = matchCatalogModel(catalog.kind === "ready" ? catalog.models : [], sessionModel);
  const chosenModel =
    model ?? catalogModel ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);
  const thinkingStops = thinkingLevelsFor(chosenModel);
  const chosenThinking = supportedThinkingLevel(chosenModel, thinking ?? sessionThinking);
  const canThink = thinkingStops.length > 1;
  const busy = sending || staging;
  const attachDisabled = busy || images.length >= MAX_ATTACHMENTS;
  const gaugeFromRight = running && !dictation.recording ? 109 : 68.5;

  const focus = useDerivedValue(() => Math.max(keyboard.progress.get(), focusDrive.get()));
  // Distance from the window bottom to the card's bottom edge. OverKeyboardView
  // is a full-screen window, so both overlays park against this instead of
  // measuring — KeyboardStickyView's translate does not show up in layout Y.
  const cardDock = useDerivedValue(() => {
    const lifted = -keyboard.height.get();
    const pad = insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get();
    const gap = interpolate(focus.get(), [0, 1], [COMPOSER.collapsed.gap, COMPOSER.expanded.gap]);
    return lifted + pad + gap;
  });
  const plusLeft = useDerivedValue(() => {
    const inset = interpolate(focus.get(), [0, 1], [COMPOSER.collapsed.inset, COMPOSER.expanded.inset]);
    return gutters.left + inset + 24 - COMPOSER.hit / 2;
  });
  const gaugeCenterX = windowWidth - gutters.right - gaugeFromRight;

  useEffect(() => {
    if (sessionThinking === undefined) return;
    setThinking(sessionThinking);
  }, [sessionThinking]);

  useEffect(() => {
    if (selectorOpen) return;
    thinkingAt.set(thinkingIndex(thinkingLevelsFor(chosenModel), chosenThinking));
  }, [chosenThinking, chosenModel, selectorOpen, thinkingAt]);

  useEffect(() => {
    if (!selectorOpen) return;
    const frame = requestAnimationFrame(() => {
      if (opening.get()) selector.set(withSpring(1, SPRING.open));
    });
    return () => cancelAnimationFrame(frame);
  }, [selectorOpen, opening, selector]);

  useAnimatedReaction(
    () => !opening.get() && selector.get() < SELECTOR.handoff,
    (landed, wasLanded) => {
      if (landed && !wasLanded) scheduleOnRN(setSelectorOpen, false);
    },
  );

  useEffect(() => {
    if (completion === undefined) return;
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
  }, [completion, attachExtend, attachProgress]);

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

  const configureSession = (
    sessionId: SessionId,
    next: {
      model?: ModelInfo;
      thinkingLevel?: ThinkingLevel;
    },
  ) =>
    client.sessions.configure({
      sessionId,
      ...(next.model === undefined
        ? {}
        : { model: { provider: next.model.provider, id: next.model.id } }),
      ...(next.thinkingLevel === undefined ? {} : { thinkingLevel: next.thinkingLevel }),
    });

  const submit = async () => {
    if (busy || !hasContent || dictation.recording) return;
    const submitted = draft;
    const submittedImages = images;
    const content = buildContent();
    const line = images.length === 0 ? parseCommandLine(draft, commands) : undefined;
    setNotice(undefined);
    if (target.kind === "new") {
      setStarting(true);
      setLocalError(undefined);
      try {
        const typed = draft.trim().split("\n")[0]?.slice(0, 48) ?? "";
        const name = line?.name ?? (typed === "" ? "New conversation" : typed);
        const session = await client.sessions.create({ name });
        await configureSession(session.sessionId, {
          model: chosenModel,
          thinkingLevel: chosenThinking,
        });
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

  const closeSelector = () => {
    opening.set(false);
    selector.set(withSpring(0, SPRING.close));
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

  const openAttach = () => {
    if (attachDisabled) return;
    if (selectorOpen) closeSelector();
    setAttachVisible(true);
    attachProgress.set(withSpring(1, SPRING.open));
    setLocalError(undefined);
    loadPhotos();
  };

  const openSelector = () => {
    if (!canThink) return;
    if (attachVisible) closeAttach();
    opening.set(true);
    if (selectorOpen) selector.set(withSpring(1, SPRING.open));
    else setSelectorOpen(true);
  };

  const attachPhoto = async (photo: RecentPhoto) => {
    if (busy || images.length >= MAX_ATTACHMENTS) return;
    closeAttach();
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
    const nextThinking = supportedThinkingLevel(choice, chosenThinking);
    setModel(choice);
    setThinking(nextThinking);
    if (thinkingLevelsFor(choice).length < 2) closeSelector();
    if (target.kind !== "session") return;
    void configureSession(target.sessionId, { model: choice, thinkingLevel: nextThinking }).catch(
      (cause: unknown) => setLocalError(describeHostError(cause)),
    );
  };

  const chooseThinking = (choice: ThinkingLevel) => {
    setThinking(choice);
    if (target.kind !== "session") return;
    void configureSession(target.sessionId, { thinkingLevel: choice }).catch((cause: unknown) =>
      setLocalError(describeHostError(cause)),
    );
  };

  const startDictation = async () => {
    dictationBase.current = draft.trimEnd();
    await dictation.start();
  };

  const { collapsed, expanded } = COMPOSER;
  const keyboardInset = useAnimatedStyle(() => ({
    paddingBottom: insets.bottom + (spacing.sm - insets.bottom) * keyboard.progress.get(),
  }));
  const cardStyle = useAnimatedStyle(() => {
    const amount = focus.get();
    return {
      marginHorizontal: interpolate(amount, [0, 1], [collapsed.inset, expanded.inset]),
      marginBottom: interpolate(amount, [0, 1], [collapsed.gap, expanded.gap]),
      height: interpolate(amount, [0, 1], [collapsed.height, expanded.height]),
      borderRadius: interpolate(amount, [0, 1], [collapsed.radius, expanded.radius]),
    };
  });
  const inputStyle = useAnimatedStyle(() => {
    const amount = focus.get();
    return {
      left: interpolate(amount, [0, 1], [50, 16]),
      right: interpolate(amount, [0, 1], [80, 16]),
      bottom: interpolate(amount, [0, 1], [24, 66]) - 11,
    };
  });
  const revealStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(focus.get(), [0.35, 1], [0, 1], Extrapolation.CLAMP) *
      interpolate(
        selector.get(),
        [SELECTOR.handoff, SELECTOR.handoff * 4],
        [1, 0],
        Extrapolation.CLAMP,
      ),
    transform: [{ scale: interpolate(focus.get(), [0.35, 1], [0.6, 1], Extrapolation.CLAMP) }],
  }));
  const modelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.get(), [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const models = catalog.kind === "ready" ? catalog.models : [];

  return (
    <Animated.View
      style={[
        {
          backgroundColor: HAS_GLASS
            ? "transparent"
            : backdrop === "canvas"
              ? theme.canvas
              : theme.background,
        },
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
        {completion === undefined ? null : (
          <SuggestionMenu completion={completion} onAccept={accept} />
        )}
        {target.kind === "new" ? (
          <WorkspacePicker client={client} onWorkspaceChange={onWorkspaceChange} />
        ) : null}
        <ContextRow
          head={target.kind === "session" ? target.head : undefined}
          heads={target.kind === "session" ? target.heads : []}
          onChooseHead={chooseHead}
        />
        <AnimatedGlass isInteractive style={[field.card, cardStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => fieldRef.current?.focus()} />
          <AnimatedTextInput
            ref={fieldRef}
            style={[
              field.input,
              inputStyle,
              { color: dictation.recording ? theme.accent : theme.foreground },
            ]}
            value={draft}
            onChangeText={(text) => {
              setCaret((current) =>
                current >= draft.length ? text.length : Math.min(current, text.length),
              );
              setDraft(text);
            }}
            onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
              setCaret(event.nativeEvent.selection.end);
            }}
            onFocus={() => {
              setFocused(true);
              focusDrive.set(withSpring(1, SPRING.focus));
            }}
            onBlur={() => {
              setFocused(false);
              focusDrive.set(withSpring(0, SPRING.focus));
            }}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            editable={!sending && !dictation.recording}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            keyboardAppearance={dark ? "dark" : "light"}
            accessibilityLabel={placeholder}
          />
          <View style={[field.hit, field.plus]} pointerEvents="box-none">
            <Pressable
              accessibilityLabel="Add attachment"
              disabled={attachDisabled}
              onPress={openAttach}
              hitSlop={8}
              style={[StyleSheet.absoluteFill, field.center, attachDisabled && field.disabled]}
            >
              {attachVisible ? null : (
                <SymbolView
                  name="plus"
                  size={20}
                  tintColor={theme.foreground}
                  weight="regular"
                />
              )}
            </Pressable>
          </View>
          {catalog.kind === "ready" ? (
            <Animated.View
              style={[
                field.model,
                modelStyle,
                { right: (canThink ? gaugeFromRight : 24) + COMPOSER.hit / 2 + 8 },
              ]}
              pointerEvents="box-none"
            >
              <Host matchContents={{ horizontal: true }} style={modelHost} ignoreSafeArea="all">
                <Menu
                  label={
                    <Text modifiers={[font(MODEL_FONT), foregroundStyle(theme.muted)]}>
                      {chosenModel?.name ?? "Model"}
                    </Text>
                  }
                  modifiers={[
                    buttonStyle("plain"),
                    buttonBorderShape("capsule"),
                    controlSize("mini"),
                    menuIndicator("hidden"),
                  ]}
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
                      onPress={() => chooseModel(item)}
                    />
                  ))}
                </Menu>
              </Host>
            </Animated.View>
          ) : null}
          {canThink ? (
            <Animated.View
              style={[field.hit, { right: gaugeFromRight - COMPOSER.hit / 2 }, revealStyle]}
              pointerEvents="box-none"
            >
              <Pressable
                accessibilityLabel="Thinking level"
                onPress={openSelector}
                hitSlop={10}
                style={field.center}
              >
                <GaugeIcon
                  level={thinkingAt}
                  stopCount={thinkingStops.length}
                  accent={theme.accent}
                  track={theme.muted}
                  needle={theme.foreground}
                />
              </Pressable>
            </Animated.View>
          ) : null}
          {running && !dictation.recording ? (
            <Pressable
              accessibilityLabel={stopping ? "Stopping" : "Stop"}
              disabled={stopping}
              onPress={() => {
                if (target.kind === "session") target.onStop();
              }}
              hitSlop={8}
              style={[field.hit, field.stop, stopping && field.disabled]}
            >
              <SymbolView name="stop.fill" size={18} tintColor={theme.foreground} />
            </Pressable>
          ) : null}
          {dictation.recording ? (
            <Pressable
              accessibilityLabel={`Stop dictation, ${formatElapsed(dictation.elapsed)}`}
              onPress={dictation.stop}
              style={field.recorder}
            >
              <SymbolView
                name="stop.circle.fill"
                size={controls.badge}
                tintColor={theme.foreground}
              />
              <Animated.Text style={[field.recorderTime, { color: theme.foreground }]}>
                {formatElapsed(dictation.elapsed)}
              </Animated.Text>
              <View style={field.waveform} pointerEvents="none">
                {dictation.levels.map((sample, index) => (
                  <View
                    key={index}
                    style={[
                      field.waveBar,
                      { height: waveHeight(sample), backgroundColor: theme.muted },
                    ]}
                  />
                ))}
              </View>
            </Pressable>
          ) : hasContent ? (
            <Pressable
              accessibilityLabel={sending ? "Sending" : "Send"}
              disabled={busy}
              onPress={() => {
                void submit();
              }}
              style={[field.send, { backgroundColor: theme.accent }, busy && field.disabled]}
            >
              <SymbolView name="arrow.up" size={16} tintColor={theme.onAccent} weight="semibold" />
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Dictate"
              disabled={busy}
              onPress={() => {
                void startDictation();
              }}
              hitSlop={8}
              style={[field.hit, field.primary, busy && field.disabled]}
            >
              <SymbolView name="mic.fill" size={22} tintColor={theme.foreground} />
            </Pressable>
          )}
        </AnimatedGlass>
      </html.div>
      {selectorOpen ? (
      <ThinkingSelector
        visible={selectorOpen}
        progress={selector}
        level={thinkingAt}
        cardDock={cardDock}
        gaugeCenterX={gaugeCenterX}
        levels={thinkingStops}
        modelName={chosenModel?.name ?? "Model"}
        colors={{
          text: theme.foreground,
          accent: theme.accent,
          track: dark ? "rgba(44, 44, 46, 0.86)" : "rgba(250, 250, 250, 0.86)",
          tickOnTrack: dark ? "rgba(255, 255, 255, 0.28)" : "rgba(0, 0, 0, 0.24)",
          tickOnFill: "rgba(255, 255, 255, 0.2)",
          knob: "#FFFFFF",
          gaugeTrack: theme.muted,
          needle: theme.foreground,
          scrim: dark ? "rgba(0, 0, 0, 0.45)" : "rgba(255, 255, 255, 0.55)",
        }}
        onClose={closeSelector}
        onCommit={(index) => {
          const next = thinkingStops[index];
          if (next !== undefined) chooseThinking(next);
        }}
      />
      ) : null}
      {attachVisible ? (
        <AttachmentsMenu
          visible={attachVisible}
          progress={attachProgress}
          extendProgress={attachExtend}
          keyboardHeight={keyboard.height}
          cardDock={cardDock}
          plusLeft={plusLeft}
          access={access}
          disabled={attachDisabled}
          onClose={closeAttach}
          onPick={(photo) => void attachPhoto(photo)}
          onManageAccess={() => {
            void chooseSharedPhotos().then(loadPhotos);
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
    (item) =>
      item.id === ref.id && (ref.provider === undefined || item.provider === ref.provider),
  );
}

const hit = { width: COMPOSER.hit, height: COMPOSER.hit };

const field = StyleSheet.create({
  card: { borderCurve: "continuous" },
  input: {
    position: "absolute",
    height: 22,
    fontSize: COMPOSER.fontSize,
    padding: 0,
  },
  hit: {
    ...hit,
    position: "absolute",
    bottom: ICON_ROW_BOTTOM - COMPOSER.hit / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { alignItems: "center", justifyContent: "center", ...hit },
  plus: { left: 24 - COMPOSER.hit / 2, zIndex: 1 },
  model: {
    position: "absolute",
    left: 24 + COMPOSER.hit / 2 + 8,
    bottom: ICON_ROW_BOTTOM - COMPOSER.hit / 2,
    height: COMPOSER.hit,
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  stop: { right: 68.5 - COMPOSER.hit / 2 },
  primary: { right: 24 - COMPOSER.hit / 2 },
  send: {
    position: "absolute",
    right: 24 - COMPOSER.sendSize / 2,
    bottom: ICON_ROW_BOTTOM - COMPOSER.sendSize / 2,
    width: COMPOSER.sendSize,
    height: COMPOSER.sendSize,
    borderRadius: COMPOSER.sendSize / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: controls.disabledOpacity },
  recorder: {
    position: "absolute",
    right: 8,
    bottom: ICON_ROW_BOTTOM - COMPOSER.hit / 2,
    height: COMPOSER.hit,
    paddingHorizontal: 8,
    borderRadius: COMPOSER.hit / 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recorderTime: {
    fontSize: typography.caption.fontSize,
    fontVariant: ["tabular-nums"],
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    height: 16,
    overflow: "hidden",
  },
  waveBar: { width: 3, borderRadius: 99 },
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
  insets: (left: number, right: number) => ({
    paddingLeft: left,
    paddingRight: right,
  }),
});
