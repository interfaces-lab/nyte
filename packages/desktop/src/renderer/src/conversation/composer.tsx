/**
 * The input surface has two layouts: the new-chat field stacks above its
 * controls while the follow-up field is one compact row. Attachments stay
 * inside its frame, above the editor, while queued follow-ups use the separate
 * toolbar card.
 * The frame and behavior stay shared.
 *
 * Admission is open (invariant 5): sending while a run is live is not an
 * error. Enter uses the selected queue or steer delivery, and Cmd/Ctrl+Enter
 * uses the other. The toolbar card shows still-pending queue items with edit,
 * cancel, and "send now" (`redeliver`), Enter on an empty composer sends the
 * first of them now, and Esc requests a durable abort.
 */
import { trayStyles } from "../theme/tray.stylex.ts";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Delivery, PendingItem, RunId, RunInfo, SessionId } from "@nyte-ai/protocol";
import { isTerminalPhase } from "@nyte-ai/client";
import { errorMessage } from "../../../shared/errors.ts";
import { Icon } from "../components/icons.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { refreshThread } from "../live.ts";
import {
  keys,
  queryClient,
  useApplyPluginSetting,
  useCatalog,
  useConfigureSession,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  usePluginSettings,
  useSessionSnapshot,
} from "../queries.ts";
import { nyte } from "../nyte.ts";
import type { OutboxRow } from "@nyte-ai/client";
import { outbox } from "../use-outbox.ts";
import { macPlatform } from "../platform.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "../layout/session-view-state.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import { formatContextWindow } from "./model-picker-state.ts";
import { ModelPicker, type ModelPickerChange } from "./model-picker.tsx";
import { ImagePreview } from "./image-preview.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor.tsx";
import { composerSource, useComposerSuggestions } from "./composer-suggestions.tsx";
import type { ComposerMentionFiles, ComposerSuggestionCatalog } from "./composer-suggestions.tsx";
import { bindComposerFileDrop, carriesFiles } from "./composer-file-drop.ts";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import {
  composerEnterAction,
  deliveryChoices,
  modifierKeyLabel,
  nextToSteer,
  submissionDelivery,
} from "./composer-keys.ts";
import type { SubmitAction } from "./composer-keys.ts";
import { composerMessageContent, composerSendInput, composerSendPlan } from "./composer-send.ts";
import { UserMessageText, messageImages, userMessageText } from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import {
  useRunningMessagePreference,
  type RunningMessagePreference,
} from "./running-message-preference.ts";
import { composerStyles } from "./styles.stylex.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";
const DROP_PLACEHOLDER = "Drop here to attach…";
/** Measured on the composer frame, which sits inside the conversation gutters, not the pane. */
const COMPACT_FRAME_WIDTH = 320;

type ComposerSurface = "new-chat" | "follow-up";
type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

/**
 * Session-bound chip: shows the selected inputs for the next message, even
 * while an older run is still executing. The context gauge continues to
 * describe that run's context.
 */
const SessionModelChip = memo(function SessionModelChip({
  sessionId,
}: {
  sessionId: SessionId;
}): ReactElement | null {
  const catalog = useCatalog(sessionId);
  const snapshot = useSessionSnapshot(sessionId);
  const configure = useConfigureSession(sessionId);
  const context = snapshot.data?.context;
  const options = catalog.data?.models ?? [];
  const configured = snapshot.data?.session.config.model ?? snapshot.data?.config.model;
  const current = options.find(
    (option) =>
      option.id === configured?.id &&
      (configured.provider === undefined || option.provider === configured.provider),
  );
  const pluginSettings = usePluginSettings(
    sessionId,
    options.some((option) => option.fastMode.kind === "available"),
  );
  const applyPluginSetting = useApplyPluginSetting(sessionId);
  const fastEnabled = useMemo(
    () =>
      new Set(
        (pluginSettings.data ?? [])
          .filter((setting) => setting.current === "on")
          .map((setting) => setting.id),
      ),
    [pluginSettings.data],
  );
  const handleChange = useCallback(
    (change: ModelPickerChange) => {
      switch (change.kind) {
        case "model":
          configure.mutate({
            model: { provider: change.option.provider, id: change.option.id },
            thinkingLevel: change.thinkingLevel,
          });
          return;
        case "thinking":
          configure.mutate({ thinkingLevel: change.thinkingLevel });
          return;
        case "fast":
          applyPluginSetting.mutate({
            id: change.settingId,
            choiceId: change.enabled ? "on" : "off",
          });
          return;
        default: {
          const _exhaustive: never = change;
          return _exhaustive;
        }
      }
    },
    [applyPluginSetting, configure],
  );

  return (
    <>
      <ModelPicker
        catalog={catalog.data}
        current={current}
        thinkingLevel={
          snapshot.data?.session.config.thinkingLevel ?? snapshot.data?.config.thinkingLevel
        }
        fastEnabled={fastEnabled}
        disabled={configure.isPending || catalog.isError || catalog.isPending}
        onChange={handleChange}
      />
      {context?.percent !== undefined && (
        <span
          {...stylex.props(composerStyles.gauge)}
          title={
            context.contextWindow === undefined
              ? `${String(context.estimatedTokens)} tokens`
              : `${String(context.estimatedTokens)} tokens of ${formatContextWindow(context.contextWindow)}`
          }
        >
          {String(Math.round(context.percent))}%
        </span>
      )}
    </>
  );
});

/** What the frame is editing instead of composing anew. */
type ComposerEditing =
  | {
      readonly kind: "queued";
      /** The queued item's delivery: Enter keeps it, the modifier swaps it for the other role. */
      readonly delivery: Delivery;
      readonly onCancel: () => void;
    }
  | {
      /** A sent message: sending branches the conversation from that point. */
      readonly kind: "message";
      readonly onCancel: () => void;
    };

interface ComposerFrameProps {
  /** Placement is caller intent; the follow-up surface derives its own geometry. */
  readonly surface: ComposerSurface;
  /** The draft to show. The frame reports every edit back; the parent owns the value. */
  document: ComposerDocumentState;
  onDocumentChange: (document: ComposerDocumentState) => void;
  /** The parent clears the exact live document passed here and restores it if the send is refused. */
  onSubmit: (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ) => boolean | Promise<boolean>;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** A run is live: empty-input Esc and the stop button both request an abort. */
  busy?: boolean;
  /** The abort is asked and not yet settled; Stop draws but takes no second request. */
  stopping?: boolean;
  onAbort?: () => void;
  /** An open composer tray handles Escape before the empty-input abort shortcut. */
  onDismissTray?: () => boolean;
  /** Enter on a truly empty composer; return true when it was handled. */
  onEmptySubmit?: () => boolean;
  /** The model chip slot, left side of the controls row. */
  model?: ReactNode;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  onFocusChange?: (focused: boolean) => void;
  suggestionCatalog: ComposerSuggestionCatalog;
  /** Workspace entries behind `@`. Callers without an open workspace pass an empty ready list. */
  mentionFiles: ComposerMentionFiles;
  hasConversationContext?: boolean;
  attachments?: readonly ComposerImageAttachment[];
  attachmentBusy?: boolean;
  attachmentError?: string;
  onFilesSelected?: (files: readonly File[]) => void;
  onAttachmentRemove?: (id: string) => void;
  editing?: ComposerEditing;
  runningMessagePreference?: RunningMessagePreference;
}

/** The frame both composers share: autosizing inline editor and shared controls. */
export function ComposerFrame({
  surface,
  document,
  onDocumentChange,
  onSubmit,
  placeholder,
  autoFocus = false,
  disabled = false,
  busy = false,
  stopping = false,
  onAbort,
  onDismissTray,
  onEmptySubmit,
  model,
  inputRef,
  onFocusChange,
  suggestionCatalog,
  mentionFiles,
  hasConversationContext = false,
  attachments = [],
  attachmentBusy = false,
  attachmentError,
  onFilesSelected,
  onAttachmentRemove,
  editing,
  runningMessagePreference = "queue",
}: ComposerFrameProps): ReactElement {
  const frameRef = useRef<HTMLFormElement>(null);
  const areaRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const host = useHostState();
  const [dragging, setDragging] = useState(false);
  const [editorNeedsExpansion, setEditorNeedsExpansion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [focused, setFocused] = useState(false);
  const [references, setReferences] = useState<readonly MessageReference[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const suggestionMenu = useComposerSuggestions({
    editorRef: areaRef,
    anchorRef: frameRef,
    side: surface === "new-chat" ? "bottom" : "top",
    suggestionCatalog,
    mentionFiles,
    hasConversationContext,
    references,
  });
  const roles = useMemo(() => deliveryChoices, []);
  const canAttach = onFilesSelected !== undefined;
  const hasInstructionChip = references.some((reference) => reference.kind !== "mention");
  const hasSubmission = document.text.trim() !== "" || attachments.length > 0 || hasInstructionChip;
  const canSubmit = !disabled && !submitting && !attachmentBusy && hasSubmission;
  const collapsed = surface === "follow-up" && narrow && !focused;
  const geometry: ComposerGeometry =
    surface === "new-chat"
      ? "new-chat"
      : editorNeedsExpansion && !collapsed
        ? "follow-up-expanded"
        : "follow-up-compact";
  const compact = geometry === "follow-up-compact";
  const followUpExpanded = geometry === "follow-up-expanded";
  const followUpCard =
    surface === "follow-up" &&
    !collapsed &&
    (followUpExpanded ||
      attachments.length > 0 ||
      attachmentError !== undefined ||
      editing !== undefined);
  const modifier = modifierKeyLabel(macPlatform(host.data?.platform));
  const sendLabel =
    editing?.kind === "queued"
      ? busy
        ? "Update and interrupt"
        : "Update queued message"
      : editing?.kind === "message"
        ? "Send edited message"
        : busy
          ? runningMessagePreference === "queue"
            ? "Queue message"
            : "Steer agent"
          : "Send";
  const sendTitle =
    editing?.kind === "queued"
      ? busy
        ? "Update and interrupt (Enter)"
        : editing.delivery === roles.steer
          ? `Update (Enter) · Queue instead (${modifier}Enter)`
          : `Update (Enter) · Steer instead (${modifier}Enter)`
      : editing?.kind === "message"
        ? "Send edited message (Enter)"
        : busy
          ? runningMessagePreference === "queue"
            ? `Queue (Enter) · Steer (${modifier}Enter)`
            : `Steer (Enter) · Queue (${modifier}Enter)`
          : "Send (Enter)";

  // Follow-up text scrolls on one line so the composer stays compact. An explicit
  // line break expands the card; width alone must not make the controls overflow.
  const resize = useCallback(
    (text?: string): void => {
      const area = areaRef.current?.element;
      if (surface === "new-chat" || area === null || area === undefined) return;
      if ((text ?? area.textContent).length === 0) {
        setEditorNeedsExpansion(false);
        return;
      }
      if (editorNeedsExpansion) return;
      if (area.scrollHeight > Number.parseFloat(getComputedStyle(area).lineHeight) * 1.5) {
        setEditorNeedsExpansion(true);
      }
    },
    [surface, editorNeedsExpansion],
  );

  useLayoutEffect(() => {
    const area = areaRef.current?.element;
    const frame = frameRef.current;
    if (area === null || area === undefined || frame === null) return undefined;
    const measure = (): void => {
      setNarrow(frame.getBoundingClientRect().width < COMPACT_FRAME_WIDTH);
      resize();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [resize]);

  const submit = async (action: SubmitAction): Promise<void> => {
    if (!canSubmit) return;
    const area = areaRef.current;
    if (area === null) return;
    const submission = area.read();
    const currentDocument = area.readDocument();
    if (frameRef.current?.contains(window.document.activeElement)) {
      area.focus({ preventScroll: true });
    }
    setSubmitting(true);
    // `onSubmit` may answer synchronously; `Promise.resolve` covers both, and the
    // chain avoids a `try`/`finally` that would cost this component its
    // compiler memoization.
    return Promise.resolve(
      onSubmit(
        submission,
        submissionDelivery(
          action,
          roles,
          editing?.kind === "queued" ? editing.delivery : undefined,
          busy && editing === undefined ? runningMessagePreference : "queue",
        ),
        currentDocument,
      ),
    )
      .then(() => undefined)
      .finally(() => setSubmitting(false));
  };

  const attachmentList =
    collapsed || attachments.length === 0 ? undefined : (
      <ul
        aria-label="Image attachments"
        {...stylex.props(
          composerStyles.attachments,
          surface === "follow-up" && composerStyles.attachmentsInset,
          compact && composerStyles.attachmentsInsetCompact,
        )}
      >
        {attachments.map((attachment) => (
          <li key={attachment.id} {...stylex.props(composerStyles.attachment)}>
            <ImagePreview src={attachment.previewUrl} name={attachment.name} compact />
            {onAttachmentRemove !== undefined && (
              <Button
                unstyled
                type="button"
                aria-label={`Remove ${attachment.name}`}
                disabled={disabled}
                onClick={() => onAttachmentRemove(attachment.id)}
                {...stylex.props(composerStyles.attachmentRemove, focus.ring)}
              >
                <Icon name="x" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  const attachmentAlert =
    collapsed || attachmentError === undefined ? undefined : (
      <div
        role="alert"
        {...stylex.props(
          composerStyles.attachmentError,
          surface === "follow-up" && composerStyles.attachmentErrorInset,
          compact && composerStyles.attachmentErrorInsetCompact,
        )}
      >
        {attachmentError}
      </div>
    );

  return (
    <>
      <form
        data-composer-frame
        ref={frameRef}
        aria-label="Message composer"
        onFocus={() => setFocused(true)}
        onBlur={(event) => setFocused(event.currentTarget.contains(event.relatedTarget))}
        onKeyDown={(event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            disabled ||
            submitting ||
            suggestionMenu.open ||
            editing === undefined
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          editing.onCancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit("submit");
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled && canAttach && carriesFiles(event)) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          const accepted = !disabled && canAttach && carriesFiles(event);
          event.dataTransfer.dropEffect = accepted ? "copy" : "none";
          if (accepted) setDragging(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragging(false);
        }}
        onDropCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          if (disabled || !canAttach || !carriesFiles(event)) return;
          onFilesSelected(Array.from(event.dataTransfer.files));
        }}
        onDragEnd={() => setDragging(false)}
        {...stylex.props(
          composerStyles.frame,
          geometry === "new-chat" && composerStyles.frameNewChat,
          compact && composerStyles.frameFollowUpCompact,
          followUpCard && composerStyles.frameFollowUpExpanded,
          dragging && composerStyles.frameDragging,
        )}
      >
        {dragging && <span aria-hidden="true" {...stylex.props(composerStyles.dropGuard)} />}
        {canAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={disabled}
            tabIndex={-1}
            {...stylex.props(composerStyles.fileInput)}
            onChange={(event) => {
              const picked = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (picked.length > 0) onFilesSelected(picked);
            }}
          />
        )}
        {attachmentList}
        {attachmentAlert}
        <div
          {...stylex.props(
            composerStyles.layout,
            geometry === "new-chat" && composerStyles.layoutNewChat,
            compact && composerStyles.layoutCompact,
          )}
        >
          <div
            {...stylex.props(
              composerStyles.editor,
              compact && composerStyles.editorCompact,
              collapsed && composerStyles.editorCollapsed,
              followUpExpanded && composerStyles.editorExpanded,
            )}
          >
            <ComposerEditor
              ref={areaRef}
              inputRef={inputRef}
              className={
                stylex.props(
                  composerStyles.input,
                  geometry === "new-chat" && composerStyles.inputNewChat,
                  compact && composerStyles.inputCompact,
                ).className
              }
              files={suggestionMenu.files}
              combobox={suggestionMenu.combobox}
              placeholder={dragging ? DROP_PLACEHOLDER : placeholder}
              document={document}
              autoFocus={autoFocus && !disabled}
              disabled={disabled}
              onReferencesChange={setReferences}
              onDocumentChange={(next, completion) => {
                onDocumentChange(next);
                resize(next.text);
                suggestionMenu.onCompletionChange(completion);
              }}
              onFilesSelected={onFilesSelected}
              onFocusChange={onFocusChange}
              onKeyDown={(event) => {
                if (suggestionMenu.onKeyDown(event)) return;
                const enter = composerEnterAction(event);
                if (enter === "submit" || enter === "submit-alternate") {
                  event.preventDefault();
                  // Enter on an empty composer adds the first queued follow-up
                  // to the next response; anything still composing sends as usual.
                  if (
                    enter === "submit" &&
                    !disabled &&
                    !submitting &&
                    editing === undefined &&
                    document.text.trim() === "" &&
                    attachments.length === 0 &&
                    references.length === 0 &&
                    onEmptySubmit?.() === true
                  )
                    return;
                  void submit(enter);
                  return;
                }
                if (event.key !== "Escape" || suggestionMenu.open || disabled) return;
                if (editing !== undefined) return;
                if (onDismissTray?.()) {
                  event.preventDefault();
                  return;
                }
                if (
                  busy &&
                  !stopping &&
                  document.text.trim() === "" &&
                  attachments.length === 0 &&
                  references.length === 0 &&
                  onAbort !== undefined
                ) {
                  event.preventDefault();
                  onAbort();
                }
              }}
            />
          </div>
          {suggestionMenu.menu}
          <div
            {...stylex.props(
              composerStyles.controls,
              compact && composerStyles.controlsCompact,
              followUpExpanded && composerStyles.controlsInset,
            )}
          >
            <Menu
              label="Add to message"
              popupStyle={composerStyles.addMenu}
              finalFocus={() => areaRef.current?.element}
              trigger={
                <Button
                  unstyled
                  type="button"
                  aria-label="Add to message"
                  disabled={disabled}
                  {...stylex.props(
                    composerStyles.addButton,
                    composerStyles.controlHitArea,
                    compact && composerStyles.addButtonCompact,
                    focus.ring,
                  )}
                >
                  <Icon name="plus" />
                </Button>
              }
            >
              <MenuItem icon="skills" meta="/" onSelect={() => suggestionMenu.insertTrigger("/")}>
                Commands, skills, and prompts
              </MenuItem>
              <MenuItem icon="more" meta="@" onSelect={() => suggestionMenu.insertTrigger("@")}>
                Mention context
              </MenuItem>
              {canAttach && (
                <>
                  <MenuSeparator />
                  <MenuItem icon="paperclip" onSelect={() => fileInputRef.current?.click()}>
                    Files
                  </MenuItem>
                </>
              )}
            </Menu>
            <span
              {...stylex.props(
                composerStyles.modelSlot,
                compact && composerStyles.modelSlotCompact,
              )}
            >
              {model}
            </span>
            <span
              {...stylex.props(composerStyles.spacer, compact && composerStyles.spacerCompact)}
            />
            {busy && onAbort !== undefined && (
              <Button
                unstyled
                type="button"
                aria-label={stopping ? "Stopping" : "Stop"}
                title={stopping ? "Stopping…" : "Stop (Esc)"}
                disabled={disabled || stopping}
                onClick={onAbort}
                {...stylex.props(
                  composerStyles.send,
                  composerStyles.controlHitArea,
                  compact && composerStyles.sendCompact,
                  focus.ring,
                )}
              >
                <Icon name="square" />
              </Button>
            )}
            {(!busy || onAbort === undefined || hasSubmission) && (
              <Button
                unstyled
                type="submit"
                aria-label={sendLabel}
                title={sendTitle}
                disabled={!canSubmit}
                {...stylex.props(
                  composerStyles.send,
                  composerStyles.controlHitArea,
                  compact && composerStyles.sendCompact,
                  focus.ring,
                )}
              >
                <Icon name="arrow-up" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </>
  );
}

function QueuedMessageContent({
  content,
}: {
  readonly content: PendingItem["content"];
}): ReactElement {
  const text = userMessageText(content);
  if (text === "") {
    const imageCount = messageImages(content).length;
    const summary = imageCount === 1 ? "1 image" : `${String(imageCount)} images`;
    return (
      <span title={summary} {...stylex.props(composerStyles.queuePreview)}>
        {summary}
      </span>
    );
  }
  return (
    <span title={text} {...stylex.props(composerStyles.queuePreview)}>
      <UserMessageText text={text} />
    </span>
  );
}

type MessageKeyState =
  | { readonly kind: "pending"; readonly item: PendingItem }
  | { readonly kind: "landed" }
  | { readonly kind: "absent" };

async function messageKeyState(sessionId: SessionId, key: string): Promise<MessageKeyState> {
  const snapshot = await nyte.sessions.snapshot({ sessionId });
  const item = snapshot?.pending.find((candidate) => candidate.key === key);
  if (item !== undefined) return { kind: "pending", item };
  const landed = snapshot?.transcript.some(
    (turn) =>
      turn.kind === "turn" && turn.parts.some((part) => part.kind === "user" && part.key === key),
  );
  return landed === true ? { kind: "landed" } : { kind: "absent" };
}

interface ComposerFeedback {
  readonly kind: "status" | "error";
  readonly message: string;
  /** Puts a draft the send refused back in front of whatever was typed since. */
  readonly restore?: () => void;
}

/** What one queued row is doing right now; absent means idle. */
type PendingRowAction =
  | { readonly kind: "cancelling" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly message: string };

type PendingEdit = {
  readonly delivery: Delivery;
  readonly content: PendingItem["content"];
} & (
  | {
      readonly kind: "durable";
      readonly change: PendingItem["change"];
      readonly key: PendingItem["key"];
    }
  | {
      readonly kind: "cancelling";
      readonly change: PendingItem["change"];
      readonly key: PendingItem["key"];
    }
  | { readonly kind: "outbox"; readonly key: string }
  | { readonly kind: "withdrawing"; readonly key: string }
  | { readonly kind: "withdrawn" }
);

type ReconciledOutboxEdit =
  | Extract<PendingEdit, { readonly kind: "durable" | "withdrawn" }>
  | { readonly kind: "landed" };

function reconcileOutboxEdit(
  edit: Extract<PendingEdit, { readonly kind: "outbox" | "withdrawing" }>,
  state: MessageKeyState,
): ReconciledOutboxEdit {
  switch (state.kind) {
    case "pending":
      return {
        kind: "durable",
        change: state.item.change,
        key: state.item.key,
        delivery: edit.delivery,
        content: edit.content,
      };
    case "landed":
      return state;
    case "absent":
      return { ...edit, kind: "withdrawn" };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function draftWith(document: ComposerDocumentState, text: string): ComposerDocumentState {
  const joined = document.text === "" ? text : `${text}\n${document.text}`;
  return { text: joined, selectionStart: joined.length, selectionEnd: joined.length };
}

export function Composer({
  sessionId,
  run,
  pending,
  unsent,
  disabled = false,
  initialViewState = DEFAULT_COMPOSER_VIEW_STATE,
  onViewStateChange,
  inputRef,
  autoFocus = true,
  fileDropRoot,
  backgroundWork,
  onScrollToBottom,
}: {
  sessionId: SessionId;
  /** The head's run as the fold holds it; Stop names it and follows its abort flag. */
  run: RunInfo | undefined;
  /** Durable queue items waiting behind a live run, in the deliverys the tray shows. */
  pending: readonly PendingItem[];
  /** Outbox rows the strip shows; rows landing as the next turn belong to the transcript. */
  unsent: readonly OutboxRow[];
  disabled?: boolean;
  /**
   * The draft to start from. The composer owns the draft while mounted and
   * reports each change; a keystroke must not re-render the transcript behind
   * it, so the parent persists without redrawing. Remount (key) to reseed.
   */
  initialViewState?: ComposerViewState;
  onViewStateChange?: (state: ComposerViewState) => void;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  autoFocus?: boolean;
  fileDropRoot?: HTMLElement | null;
  backgroundWork?: { readonly content: ReactNode; readonly onEscape: () => boolean };
  onScrollToBottom?: () => void;
}): ReactElement {
  const runningMessagePreference = useRunningMessagePreference();
  const [currentViewState, setCurrentViewState] = useState(initialViewState);
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [feedback, setFeedback] = useState<ComposerFeedback>();
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const [stopRequested, setStopRequested] = useState<RunId>();
  const liveRun = run !== undefined && !isTerminalPhase(run.phase) ? run : undefined;
  const stopping =
    liveRun !== undefined && (liveRun.abortRequested === true || stopRequested === liveRun.runId);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit>();
  const [restoringEdit, setRestoringEdit] = useState(false);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const pluginCatalog = usePluginCatalog();
  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);
  // A thread always has an open project behind it.
  const workspaceFiles = useMentionFiles(true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const roles = useMemo(() => deliveryChoices, []);
  // Sends settle later than the render that started them; they read the draft as it is then.
  const latestViewState = useRef(currentViewState);

  const updateViewState = (update: (current: ComposerViewState) => ComposerViewState): void => {
    const next = update(latestViewState.current);
    latestViewState.current = next;
    setCurrentViewState(next);
    onViewStateChange?.(next);
  };
  const setDocument = (document: ComposerDocumentState): void => {
    updateViewState((current) => ({
      ...current,
      draft: document.text,
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
    }));
  };
  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef?.(handle);
    },
    [inputRef],
  );

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    setAttachmentReads((count) => count + 1);
    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        if (result.attachments.length > 0) {
          setAttachments((current) => [...current, ...result.attachments]);
        }
        setAttachmentError(result.error);
      })
      .finally(() => setAttachmentReads((count) => count - 1));
  }, []);

  useLayoutEffect(() => {
    if (fileDropRoot === undefined || fileDropRoot === null) return undefined;
    return bindComposerFileDrop({
      element: fileDropRoot,
      disabled,
      onFiles: (files) => {
        void addFiles(files);
      },
    });
  }, [addFiles, disabled, fileDropRoot]);

  // An action stays on its change until the watch takes the row away: a
  // cancelled change leaves the queue, a redelivered one is a new change.
  const setRowAction = (change: string, action: PendingRowAction): void => {
    setRowActions((current) => {
      const shown = new Set(pending.map((item) => item.change));
      const next = new Map([...current].filter(([held]) => shown.has(held)));
      next.set(change, action);
      return next;
    });
  };

  /** A refused send puts its draft back, unless something newer is there; then the row offers it. */
  const refuse = (
    message: string,
    sent: {
      readonly document: ComposerDocumentState;
      readonly attachments: readonly ComposerImageAttachment[];
    },
  ): void => {
    const restore = (): void => {
      updateViewState((current) => {
        const document = draftWith(
          {
            text: current.draft,
            selectionStart: current.selectionStart,
            selectionEnd: current.selectionEnd,
          },
          sent.document.text,
        );
        return {
          ...current,
          draft: document.text,
          selectionStart: document.selectionStart,
          selectionEnd: document.selectionEnd,
        };
      });
      setAttachments((current) => [...sent.attachments, ...current]);
      setFeedback({ kind: "error", message });
    };
    if (latestViewState.current.draft === "") {
      restore();
      return;
    }
    setFeedback({ kind: "error", message, restore });
  };

  const deliver = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
    edit: PendingEdit | undefined,
  ): Promise<boolean> => {
    if (disabled || restoringEdit || attachmentReads !== 0) return false;
    const sentAttachments = attachments;
    const plan = composerSendPlan({
      submission,
      attachments: sentAttachments,
      commands: pluginCatalog.data?.commands ?? [],
      delivery,
    });
    if (plan.kind === "empty") return false;
    const sent = { document, attachments: sentAttachments };
    // Clear at once: the outbox row already shows the message, and the next thought never waits.
    setDocument({ text: "", selectionStart: 0, selectionEnd: 0 });
    setAttachments((current) =>
      current.filter((attachment) => !sentAttachments.includes(attachment)),
    );
    setAttachmentError(undefined);
    setFeedback(undefined);
    if (edit !== undefined) {
      const content = composerMessageContent(submission.text.trim(), sentAttachments);
      try {
        let target: Extract<PendingEdit, { readonly kind: "durable" | "cancelling" | "withdrawn" }>;
        if (edit.kind === "outbox") {
          const withdrawal = outbox.withdraw(edit.key);
          const outcome = withdrawal === undefined ? undefined : await withdrawal;
          if (outcome?.kind === "durable") {
            target = { ...edit, kind: "durable", change: outcome.change };
          } else {
            const withdrawing = { ...edit, kind: "withdrawing" } as const;
            setPendingEdit(withdrawing);
            const reconciled = reconcileOutboxEdit(
              withdrawing,
              await messageKeyState(sessionId, edit.key),
            );
            if (reconciled.kind === "landed") {
              setPendingEdit(undefined);
              setFeedback({
                kind: "error",
                message: "That message was already sent; it is in the conversation.",
              });
              return false;
            }
            target = reconciled;
            if (target.kind === "withdrawn") setPendingEdit(target);
          }
        } else if (edit.kind === "withdrawing") {
          const reconciled = reconcileOutboxEdit(edit, await messageKeyState(sessionId, edit.key));
          if (reconciled.kind === "landed") {
            setPendingEdit(undefined);
            setFeedback({
              kind: "error",
              message: "That message was already sent; it is in the conversation.",
            });
            return false;
          }
          target = reconciled;
          if (target.kind === "withdrawn") setPendingEdit(target);
        } else {
          target = edit;
        }
        if (target.kind !== "withdrawn" && target.key !== undefined) {
          const state = await messageKeyState(sessionId, target.key);
          switch (state.kind) {
            case "pending":
              target = { ...target, kind: "durable", change: state.item.change };
              break;
            case "landed":
              setPendingEdit(undefined);
              setFeedback({
                kind: "error",
                message: "That message was already sent; it is in the conversation.",
              });
              return false;
            case "absent":
              if (target.kind === "cancelling") {
                target = { ...target, kind: "withdrawn" };
                setPendingEdit(target);
              }
              break;
            default: {
              const _exhaustive: never = state;
              return _exhaustive;
            }
          }
        }
        const currentRun = (await nyte.sessions.snapshot({ sessionId }))?.run;
        const runToInterrupt =
          currentRun !== undefined && !isTerminalPhase(currentRun.phase) ? currentRun : undefined;
        const editedDelivery = runToInterrupt === undefined ? delivery : roles.steer;
        if (runToInterrupt !== undefined && target.kind !== "withdrawn") {
          let outcome: Awaited<ReturnType<typeof nyte.messages.cancel>>;
          try {
            outcome = await nyte.messages.cancel({
              sessionId,
              change: target.change,
            });
          } catch (cause: unknown) {
            setPendingEdit({ ...target, kind: "cancelling", delivery: editedDelivery });
            throw cause;
          }
          switch (outcome.kind) {
            case "cancelled":
              target = { ...target, kind: "withdrawn", delivery: editedDelivery };
              setPendingEdit(target);
              break;
            case "landed":
              setPendingEdit(undefined);
              setFeedback({
                kind: "error",
                message: "That message was already sent; it is in the conversation.",
              });
              return false;
            case "not_found":
              if (target.key === undefined) setPendingEdit(undefined);
              else setPendingEdit({ ...target, kind: "cancelling", delivery: editedDelivery });
              refuse("Couldn't confirm the queued message. Try again.", sent);
              return false;
            default: {
              const _exhaustive: never = outcome;
              return _exhaustive;
            }
          }
        }
        if (runToInterrupt !== undefined) {
          if (target.kind === "withdrawn") {
            target = { ...target, delivery: roles.steer };
            setPendingEdit(target);
          }
          setStopRequested(runToInterrupt.runId);
          try {
            const outcome = await nyte.runs.abort({ sessionId });
            setStopRequested(outcome.kind === "requested" ? outcome.runId : undefined);
          } catch (cause: unknown) {
            setStopRequested(undefined);
            throw cause;
          }
        }
        if (target.kind === "withdrawn") {
          setPendingEdit(target);
          await outbox.submit({ sessionId, content, delivery: editedDelivery });
          setPendingEdit(undefined);
          return true;
        }
        const outcome = await nyte.messages.redeliver({
          sessionId,
          change: target.change,
          delivery: editedDelivery,
          content,
        });
        switch (outcome.kind) {
          case "redelivered":
          case "unchanged":
            setPendingEdit(undefined);
            return true;
          case "landed":
            setPendingEdit(undefined);
            setFeedback({
              kind: "error",
              message: "That message was already sent; it is in the conversation.",
            });
            return false;
          case "not_found":
            if (target.key === undefined) setPendingEdit(undefined);
            refuse("Couldn't confirm the queued message. Try again.", sent);
            return false;
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      } catch (cause: unknown) {
        refuse(`Couldn't update the message: ${errorMessage(cause)}`, sent);
        return false;
      }
    }
    if (plan.kind === "command") {
      try {
        const outcome = await nyte.plugins.commands.run({ sessionId, ...plan.command });
        switch (outcome.kind) {
          case "ran":
            setFeedback(
              outcome.output === undefined
                ? undefined
                : { kind: "status", message: outcome.output },
            );
            refreshThread(sessionId);
            void queryClient.invalidateQueries({
              queryKey: keys.pluginSettings(sessionId),
              exact: true,
            });
            return true;
          case "prompt":
            await outbox.submit({ sessionId, content: outcome.prompt, delivery: plan.delivery });
            return true;
          case "not_found":
            break;
          case "failed":
            refuse(outcome.message, sent);
            return false;
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      } catch (cause: unknown) {
        refuse(errorMessage(cause), sent);
        return false;
      }
    }
    // A command line the plugin no longer knows is sent as the message it reads as.
    const content =
      plan.kind === "message"
        ? plan.content
        : composerMessageContent(submission.text.trim(), sentAttachments);
    try {
      await outbox.submit(composerSendInput(sessionId, { kind: "message", content, delivery }));
      return true;
    } catch (cause: unknown) {
      refuse(`Couldn't save the message: ${errorMessage(cause)}`, sent);
      return false;
    }
  };

  const send = (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<boolean> => deliver(submission, delivery, document, pendingEdit);

  const abort = (): void => {
    if (disabled || liveRun === undefined || stopping) return;
    setStopRequested(liveRun.runId);
    nyte.runs.abort({ sessionId, runId: liveRun.runId }).catch(() => setStopRequested(undefined));
  };

  // The watch settles every outcome but a failed request: a cancelled or
  // redelivered change leaves the tray with its event, and a landed one
  // reaches the transcript. Only a request that never arrived needs a word.
  const cancelPending = async (item: PendingItem): Promise<void> => {
    setRowAction(item.change, { kind: "cancelling" });
    try {
      await nyte.messages.cancel({ sessionId, change: item.change });
    } catch (cause: unknown) {
      setRowAction(item.change, {
        kind: "failed",
        message: `Couldn't cancel: ${errorMessage(cause)}`,
      });
    }
  };

  const sendPendingNow = async (item: PendingItem): Promise<void> => {
    setRowAction(item.change, { kind: "sending" });
    try {
      await nyte.messages.redeliver({ sessionId, change: item.change, delivery: roles.steer });
    } catch (cause: unknown) {
      setRowAction(item.change, {
        kind: "failed",
        message: `Couldn't send: ${errorMessage(cause)}`,
      });
    }
  };

  // The first queued follow-up is the one Enter adds. While it is mid-action,
  // Enter waits rather than reaching past it and reordering the queue.
  const nextQueued = nextToSteer(pending, roles);
  const nextQueuedAction = nextQueued === undefined ? undefined : rowActions.get(nextQueued.change);
  const nextIdleQueued =
    nextQueuedAction === undefined || nextQueuedAction.kind === "failed" ? nextQueued : undefined;
  const sendNextQueued = (): boolean => {
    if (nextIdleQueued === undefined) return false;
    void sendPendingNow(nextIdleQueued);
    return true;
  };
  const emptyEnterSteers =
    !disabled &&
    currentViewState.draft === "" &&
    attachments.length === 0 &&
    nextIdleQueued !== undefined;

  const canBeginEdit =
    currentViewState.draft === "" &&
    attachments.length === 0 &&
    pendingEdit === undefined &&
    !restoringEdit &&
    !disabled;
  const beginEdit = (item: PendingItem | OutboxRow): void => {
    if (!canBeginEdit) return;
    const input = "input" in item ? item.input : item;
    if (input.source?.kind === "action") return;
    let edit: PendingEdit;
    if ("input" in item) {
      edit = {
        kind: "outbox",
        key: item.key,
        delivery: item.input.delivery ?? roles.queue,
        content: item.input.content,
      };
    } else {
      edit = {
        kind: "durable",
        change: item.change,
        key: item.key,
        delivery: item.delivery,
        content: item.content,
      };
    }
    const text = messageDraftText(userMessageText(edit.content));
    setPendingEdit(edit);
    setAttachments(
      messageImages(edit.content).map((content, index) => ({
        id: crypto.randomUUID(),
        name: `Image ${String(index + 1)}`,
        content,
        previewUrl: `data:${content.mimeType};base64,${content.data}`,
      })),
    );
    setFeedback(undefined);
    setDocument({ text, selectionStart: text.length, selectionEnd: text.length });
    editorRef.current?.focus();
  };
  const restoreCancelledEdit = async (
    edit: Extract<PendingEdit, { readonly kind: "cancelling" | "withdrawing" | "withdrawn" }>,
  ): Promise<void> => {
    if (edit.kind === "withdrawing") {
      const state = await messageKeyState(sessionId, edit.key);
      if (state.kind !== "absent") return;
      await outbox.submit({ sessionId, content: edit.content, delivery: edit.delivery });
      return;
    }
    if (edit.kind === "withdrawn") {
      await outbox.submit({ sessionId, content: edit.content, delivery: edit.delivery });
      return;
    }
    const outcome = await nyte.messages.redeliver({
      sessionId,
      change: edit.change,
      delivery: edit.delivery,
      content: edit.content,
    });
    if (outcome.kind !== "not_found") return;
    if (edit.key !== undefined) {
      const state = await messageKeyState(sessionId, edit.key);
      if (state.kind !== "absent") return;
    }
    await outbox.submit({ sessionId, content: edit.content, delivery: edit.delivery });
  };
  const clearEdit = (): void => {
    setPendingEdit(undefined);
    setAttachments([]);
    setAttachmentError(undefined);
    setDocument({ text: "", selectionStart: 0, selectionEnd: 0 });
  };
  const cancelEdit = (): void => {
    if (restoringEdit) return;
    if (
      pendingEdit?.kind !== "withdrawn" &&
      pendingEdit?.kind !== "withdrawing" &&
      pendingEdit?.kind !== "cancelling"
    ) {
      clearEdit();
      return;
    }
    const edit = pendingEdit;
    setRestoringEdit(true);
    void restoreCancelledEdit(edit)
      .then(clearEdit)
      .catch((cause: unknown) => {
        setFeedback({ kind: "error", message: errorMessage(cause) });
      })
      .finally(() => setRestoringEdit(false));
  };

  /** A row action that holds focus hands it to the editor before its button goes away. */
  const releaseFocus = (button: Element): void => {
    if (button === document.activeElement) editorRef.current?.focus({ preventScroll: true });
  };

  const queuedMessageCount = pending.length + unsent.length;
  const queuedMessages =
    queuedMessageCount === 0 ? undefined : (
      <section aria-label="Queued messages" {...stylex.props(trayStyles.surface)}>
        <div {...stylex.props(trayStyles.header)}>
          <span {...stylex.props(trayStyles.title)}>
            {String(queuedMessageCount)} queued {queuedMessageCount === 1 ? "message" : "messages"}
            {emptyEnterSteers && (
              <span {...stylex.props(composerStyles.queueHint)}> · Enter to steer</span>
            )}
          </span>
        </div>
        <div {...stylex.props(trayStyles.list, composerStyles.queueList)}>
          {pending.map((item) => {
            const action = rowActions.get(item.change);
            const editingThis =
              pendingEdit?.kind === "durable" && pendingEdit.change === item.change;
            const busyRow = action?.kind === "cancelling" || action?.kind === "sending";
            const steering = item.delivery === roles.steer;
            return (
              <div
                role="status"
                key={item.change}
                data-editing={editingThis}
                data-error={action?.kind === "failed"}
                {...stylex.props(composerStyles.queueRow)}
              >
                <div {...stylex.props(composerStyles.queueMessage)}>
                  <QueuedMessageContent content={item.source?.label ?? item.content} />
                  {action?.kind === "cancelling" && (
                    <span {...stylex.props(composerStyles.queuedState)}>Cancelling…</span>
                  )}
                  {action?.kind === "failed" && (
                    <span
                      role="alert"
                      {...stylex.props(composerStyles.queuedState, composerStyles.queuedError)}
                    >
                      {action.message}
                    </span>
                  )}
                </div>
                {!busyRow && !editingThis && (
                  <div {...stylex.props(composerStyles.queueActions)}>
                    {item.source?.kind !== "action" && (
                      <IconButton
                        icon="pencil"
                        label={
                          canBeginEdit
                            ? "Edit queued message"
                            : "Send or clear your draft to edit this"
                        }
                        disabled={!canBeginEdit}
                        onClick={() => beginEdit(item)}
                      />
                    )}
                    {!steering && (
                      <IconButton
                        icon="arrow-up"
                        label="Add to next response"
                        onClick={(event) => {
                          releaseFocus(event.currentTarget);
                          void sendPendingNow(item);
                        }}
                      />
                    )}
                    <IconButton
                      icon="trash"
                      label="Remove queued message"
                      onClick={(event) => {
                        releaseFocus(event.currentTarget);
                        void cancelPending(item);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {unsent.map((row) => (
            <div
              role="status"
              key={row.key}
              data-error={row.state.kind === "retrying"}
              {...stylex.props(composerStyles.queueRow)}
            >
              <div {...stylex.props(composerStyles.queueMessage)}>
                <QueuedMessageContent content={row.input.source?.label ?? row.input.content} />
                {row.state.kind === "retrying" && (
                  <span
                    role="alert"
                    {...stylex.props(composerStyles.queuedState, composerStyles.queuedError)}
                  >
                    Couldn't send: {row.state.reason}. Retrying…
                  </span>
                )}
              </div>
              <div {...stylex.props(composerStyles.queueActions)}>
                {row.input.source?.kind !== "action" && (
                  <IconButton
                    icon="pencil"
                    label={
                      canBeginEdit ? "Edit queued message" : "Send or clear your draft to edit this"
                    }
                    disabled={!canBeginEdit}
                    onClick={() => beginEdit(row)}
                  />
                )}
                <IconButton
                  icon="trash"
                  label="Remove queued message"
                  onClick={(event) => {
                    releaseFocus(event.currentTarget);
                    const withdrawal = outbox.withdraw(row.key);
                    if (withdrawal === undefined) return;
                    void withdrawal
                      .then(async (outcome) => {
                        if (outcome.kind === "durable") {
                          await nyte.messages.cancel({ sessionId, change: outcome.change });
                        }
                      })
                      .catch((cause: unknown) => {
                        setFeedback({
                          kind: "error",
                          message: `Couldn't remove the message: ${errorMessage(cause)}`,
                        });
                      });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <div {...stylex.props(composerStyles.dock)}>
      {onScrollToBottom !== undefined && (
        <Button
          unstyled
          type="button"
          aria-label="Scroll to latest message"
          title="Scroll to latest message"
          onClick={onScrollToBottom}
          {...stylex.props(
            composerStyles.controlHitArea,
            composerStyles.scrollToBottom,
            focus.ring,
          )}
        >
          <Icon name="chevron-down" />
        </Button>
      )}
      <div role="region" aria-label="Conversation input" {...stylex.props(composerStyles.region)}>
        {feedback !== undefined && (
          <div
            role={feedback.kind === "error" ? "alert" : "status"}
            {...stylex.props(composerStyles.queued)}
          >
            <Icon name={feedback.kind === "error" ? "bubble-question" : "sparkle"} />
            <span {...stylex.props(composerStyles.queuedText)}>{feedback.message}</span>
            {feedback.restore !== undefined && (
              <Button
                unstyled
                type="button"
                onClick={feedback.restore}
                {...stylex.props(composerStyles.queuedAction, focus.ring)}
              >
                Restore draft
              </Button>
            )}
            <IconButton icon="x" label="Dismiss" onClick={() => setFeedback(undefined)} />
          </div>
        )}

        {queuedMessages}
        {backgroundWork?.content}
        <ComposerFrame
          surface="follow-up"
          document={{
            text: currentViewState.draft,
            selectionStart: currentViewState.selectionStart,
            selectionEnd: currentViewState.selectionEnd,
          }}
          onDocumentChange={(document) => {
            setFeedback((current) => (current?.kind === "status" ? undefined : current));
            setDocument(document);
          }}
          onSubmit={send}
          placeholder={FOLLOW_UP_PLACEHOLDER}
          autoFocus={autoFocus}
          disabled={disabled || restoringEdit}
          busy={liveRun !== undefined}
          runningMessagePreference={runningMessagePreference}
          stopping={stopping}
          onAbort={abort}
          onDismissTray={backgroundWork?.onEscape}
          onEmptySubmit={sendNextQueued}
          suggestionCatalog={suggestionCatalog}
          mentionFiles={mentionFiles}
          hasConversationContext
          attachments={attachments}
          attachmentBusy={attachmentReads !== 0}
          attachmentError={attachmentError}
          onFilesSelected={(files) => void addFiles(files)}
          onAttachmentRemove={(id) => {
            setAttachments((current) => current.filter((attachment) => attachment.id !== id));
            setAttachmentError(undefined);
          }}
          model={disabled ? undefined : <SessionModelChip sessionId={sessionId} />}
          inputRef={attachInput}
          onFocusChange={(focused) => updateViewState((current) => ({ ...current, focused }))}
          editing={
            pendingEdit === undefined
              ? undefined
              : { kind: "queued", delivery: pendingEdit.delivery, onCancel: cancelEdit }
          }
        />
      </div>
    </div>
  );
}
