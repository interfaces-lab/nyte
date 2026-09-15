/**
 * The input surface has two layouts: the new-chat field stacks above its
 * controls while the follow-up field is one compact row. Attachments stay
 * inside its frame, above the editor, while queued follow-ups use the separate
 * toolbar card.
 * The frame and behavior stay shared.
 *
 * Admission is open (invariant 5): sending while a run is live is not an
 * error. Enter sends to the lane that lands at the next response boundary (it
 * steers), Cmd/Ctrl+Enter to the lane that waits for an idle head (it queues a
 * follow-up), both read from the landing policy. The toolbar card shows
 * still-pending queue items with edit, cancel, and "send now"
 * (`redeliver`), Enter on an empty composer sends the first of them now, and
 * Esc requests a durable abort.
 */
import { trayStyles } from "../theme/tray.stylex.ts";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Lane, PendingItem, SessionId } from "@nyte-ai/core";
import type { ImageContent } from "@nyte-ai/schema";
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
import type { OutboxRow, OutboxRowState } from "../outbox.ts";
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
import { acceptedImageFiles, bindComposerFileDrop, carriesFiles } from "./composer-file-drop.ts";
import {
  composerEnterAction,
  laneRoles,
  modifierKeyLabel,
  nextToSteer,
  submissionLane,
} from "./composer-keys.ts";
import type { SubmitAction } from "./composer-keys.ts";
import { composerMessageContent, composerSendInput, composerSendPlan } from "./composer-send.ts";
import { UserMessageText, messageImages, userMessageText } from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { composerStyles } from "./styles.stylex.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";
const DROP_PLACEHOLDER = "Drop here to attach…";

type ComposerSurface = "new-chat" | "follow-up";
type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

export interface ComposerImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly content: ImageContent;
}

function isTextFileReaderResult(result: FileReader["result"]): result is string {
  return typeof result === "string";
}

function readImageAttachment(file: File): Promise<ComposerImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const result = reader.result;
        if (!isTextFileReaderResult(result)) {
          reject(new Error(`Could not read ${file.name}`));
          return;
        }
        const marker = ";base64,";
        const markerIndex = result.indexOf(marker);
        if (!result.startsWith("data:") || markerIndex === -1) {
          reject(new Error(`Could not encode ${file.name}`));
          return;
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          previewUrl: result,
          content: {
            type: "image",
            data: result.slice(markerIndex + marker.length),
            mimeType: file.type,
          },
        });
      },
      { once: true },
    );
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)), {
      once: true,
    });
    reader.addEventListener(
      "abort",
      () => reject(new Error(`Reading ${file.name} was cancelled`)),
      {
        once: true,
      },
    );
    reader.readAsDataURL(file);
  });
}

export async function readComposerImageAttachments(files: readonly File[]): Promise<{
  readonly attachments: readonly ComposerImageAttachment[];
  readonly error: string | undefined;
}> {
  const imageFiles = acceptedImageFiles({ files });
  if (imageFiles.length === 0) {
    return {
      attachments: [],
      error: "Nyte accepts PNG, JPEG, WebP, GIF, and BMP images.",
    };
  }
  const results = await Promise.allSettled(imageFiles.map(readImageAttachment));
  const attachments = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const error =
    attachments.length !== imageFiles.length
      ? "Some images could not be read."
      : imageFiles.length !== files.length
        ? "Nyte accepts PNG, JPEG, WebP, GIF, and BMP images."
        : undefined;
  return { attachments, error };
}

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
      /** The queued item's lane: Enter keeps it, the modifier swaps it for the other role. */
      readonly lane: Lane;
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
    lane: Lane,
    document: ComposerDocumentState,
  ) => boolean | Promise<boolean>;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** A run is live: empty-input Esc and the idle button both request an abort. */
  busy?: boolean;
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
}: ComposerFrameProps): ReactElement {
  const frameRef = useRef<HTMLFormElement>(null);
  const areaRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const host = useHostState();
  const [dragging, setDragging] = useState(false);
  const [editorNeedsExpansion, setEditorNeedsExpansion] = useState(false);
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
  const roles = useMemo(() => laneRoles(nyte.landing), []);
  const canAttach = onFilesSelected !== undefined;
  const hasInstructionChip = references.some((reference) => reference.kind !== "mention");
  const canSubmit =
    !disabled &&
    !submitting &&
    !attachmentBusy &&
    (document.text.trim() !== "" || attachments.length > 0 || hasInstructionChip);
  const geometry: ComposerGeometry =
    surface === "new-chat"
      ? "new-chat"
      : editorNeedsExpansion
        ? "follow-up-expanded"
        : "follow-up-compact";
  const compact = geometry === "follow-up-compact";
  const followUpExpanded = geometry === "follow-up-expanded";
  const followUpCard =
    surface === "follow-up" &&
    (followUpExpanded ||
      attachments.length > 0 ||
      attachmentError !== undefined ||
      editing !== undefined);
  const modifier = modifierKeyLabel(macPlatform(host.data?.platform));
  const sendLabel =
    editing?.kind === "queued"
      ? "Update queued message"
      : editing?.kind === "message"
        ? "Send edited message"
        : busy
          ? "Send now"
          : "Send";
  const sendTitle =
    editing?.kind === "queued"
      ? editing.lane === roles.steer
        ? `Update (Enter) · Queue for later instead (${modifier}Enter)`
        : `Update (Enter) · Send now instead (${modifier}Enter)`
      : editing?.kind === "message"
        ? "Send edited message (Enter)"
        : busy
          ? `Send now (Enter) · Queue for later (${modifier}Enter)`
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
    if (area === null || area === undefined) return undefined;
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(area);
    return () => observer.disconnect();
  }, [resize]);

  const submit = async (action: SubmitAction): Promise<void> => {
    if (!canSubmit) return;
    const area = areaRef.current;
    if (area === null) return;
    const submission = area.read();
    const currentDocument = area.readDocument();
    setSubmitting(true);
    // `onSubmit` may answer synchronously; `Promise.resolve` covers both, and the
    // chain avoids a `try`/`finally` that would cost this component its
    // compiler memoization.
    return Promise.resolve(
      onSubmit(
        submission,
        submissionLane(action, roles, editing?.kind === "queued" ? editing.lane : undefined),
        currentDocument,
      ),
    )
      .then(() => undefined)
      .finally(() => setSubmitting(false));
  };

  const attachmentList =
    attachments.length === 0 ? undefined : (
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
                <Icon name="x" size={12} />
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  const attachmentAlert =
    attachmentError === undefined ? undefined : (
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
        onKeyDown={(event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            disabled ||
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
          if (!disabled && canAttach && carriesFiles(event)) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (!disabled && canAttach && carriesFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (disabled || !canAttach || !carriesFiles(event)) return;
          event.preventDefault();
          // A parent transcript may also bind addFiles; don't enqueue twice.
          event.stopPropagation();
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
            accept="image/bmp,image/gif,image/jpeg,image/png,image/webp"
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
                  // Enter on an empty composer sends the first queued
                  // follow-up now; anything still composing sends as usual.
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
              label="Add agents, context, tools"
              popupStyle={composerStyles.addMenu}
              trigger={
                <Button
                  unstyled
                  type="button"
                  aria-label="Add agents, context, tools"
                  title="Skills, MCPs and more (/)"
                  disabled={disabled}
                  {...stylex.props(
                    composerStyles.addButton,
                    composerStyles.controlHitArea,
                    compact && composerStyles.addButtonCompact,
                    focus.ring,
                  )}
                >
                  <Icon name="plus" size={17} />
                </Button>
              }
            >
              <MenuItem icon="search" meta="/" onSelect={() => suggestionMenu.insertTrigger("/")}>
                Search skills and prompts…
              </MenuItem>
              <MenuSeparator />
              {canAttach && (
                <>
                  <MenuItem icon="paperclip" onSelect={() => fileInputRef.current?.click()}>
                    Files
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuItem icon="more" meta="@" onSelect={() => suggestionMenu.insertTrigger("@")}>
                Mention context
              </MenuItem>
              <MenuItem icon="skills" meta="/" onSelect={() => suggestionMenu.insertTrigger("/")}>
                Use a skill or prompt
              </MenuItem>
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
            {busy &&
            editing === undefined &&
            document.text.trim() === "" &&
            attachments.length === 0 &&
            references.length === 0 &&
            onAbort !== undefined ? (
              <Button
                unstyled
                type="button"
                aria-label="Stop"
                title="Stop (Esc)"
                disabled={disabled}
                onClick={onAbort}
                {...stylex.props(
                  composerStyles.send,
                  composerStyles.controlHitArea,
                  compact && composerStyles.sendCompact,
                  focus.ring,
                )}
              >
                <Icon name="square" size={12} />
              </Button>
            ) : (
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
                <Icon name="arrow-up" size={15} />
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

function unsentStateText(state: OutboxRowState): string {
  switch (state.kind) {
    case "saving":
      return "Saving…";
    case "sending":
      return "Sending…";
    case "failed":
      return `Couldn't send: ${state.reason}. Retrying…`;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
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

interface PendingEdit {
  readonly change: PendingItem["change"];
  readonly lane: Lane;
  readonly content: PendingItem["content"];
}

function draftWith(document: ComposerDocumentState, text: string): ComposerDocumentState {
  const joined = document.text === "" ? text : `${text}\n${document.text}`;
  return { text: joined, selectionStart: joined.length, selectionEnd: joined.length };
}

export function Composer({
  sessionId,
  working,
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
  working: boolean;
  /** Durable queue items waiting behind a live run, in the lanes the tray shows. */
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
  const [currentViewState, setCurrentViewState] = useState(initialViewState);
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [feedback, setFeedback] = useState<ComposerFeedback>();
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const [pendingEdit, setPendingEdit] = useState<PendingEdit>();
  const activePendingEdit =
    pendingEdit !== undefined && pending.some((item) => item.change === pendingEdit.change)
      ? pendingEdit
      : undefined;
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const pluginCatalog = usePluginCatalog();
  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);
  // A thread always has an open project behind it.
  const workspaceFiles = useMentionFiles(true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const roles = useMemo(() => laneRoles(nyte.landing), []);
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
    return readComposerImageAttachments(files)
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

  const setRowAction = (change: string, action: PendingRowAction | undefined): void => {
    setRowActions((current) => {
      const next = new Map(current);
      if (action === undefined) next.delete(change);
      else next.set(change, action);
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

  const send = async (
    submission: ComposerSubmission,
    lane: Lane,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    if (disabled || attachmentReads !== 0) return false;
    const sentAttachments = attachments;
    const plan = composerSendPlan({
      submission,
      attachments: sentAttachments,
      commands: pluginCatalog.data?.commands ?? [],
      lane,
    });
    if (plan.kind === "empty") return false;
    const edit = activePendingEdit;
    const sent = { document, attachments: sentAttachments };
    // Clear at once: the outbox row already shows the message, and the next thought never waits.
    setDocument({ text: "", selectionStart: 0, selectionEnd: 0 });
    setAttachments((current) =>
      current.filter((attachment) => !sentAttachments.includes(attachment)),
    );
    setAttachmentError(undefined);
    setFeedback(undefined);
    setPendingEdit(undefined);
    if (edit !== undefined) {
      const content = composerMessageContent(
        submission.text.trim(),
        [...messageImages(edit.content).map((image) => ({ content: image })), ...sentAttachments],
        submission.references,
      );
      try {
        const outcome = await nyte.messages.redeliver({
          sessionId,
          change: edit.change,
          lane,
          content,
        });
        refreshThread(sessionId);
        switch (outcome.kind) {
          case "redelivered":
          case "unchanged":
            return true;
          case "landed":
            refuse("That message was already sent; it is in the conversation.", sent);
            return false;
          case "not_found":
            refuse("That queued message is gone.", sent);
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
            await outbox.submit({ sessionId, content: outcome.prompt, lane: plan.lane });
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
        : composerMessageContent(submission.text.trim(), sentAttachments, submission.references);
    try {
      await outbox.submit(composerSendInput(sessionId, { kind: "message", content, lane }));
      return true;
    } catch (cause: unknown) {
      refuse(`Couldn't save the message: ${errorMessage(cause)}`, sent);
      return false;
    }
  };

  const abort = (): void => {
    if (disabled) return;
    void nyte.runs.abort({ sessionId });
  };

  const cancelPending = async (item: PendingItem): Promise<void> => {
    setRowAction(item.change, { kind: "cancelling" });
    try {
      const outcome = await nyte.messages.cancel({ sessionId, change: item.change });
      refreshThread(sessionId);
      setRowAction(
        item.change,
        outcome.kind === "landed"
          ? { kind: "failed", message: "Already sent; it is in the conversation." }
          : undefined,
      );
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
      const outcome = await nyte.messages.redeliver({
        sessionId,
        change: item.change,
        lane: roles.steer,
      });
      refreshThread(sessionId);
      setRowAction(
        item.change,
        outcome.kind === "landed"
          ? { kind: "failed", message: "Already sent; it is in the conversation." }
          : undefined,
      );
    } catch (cause: unknown) {
      setRowAction(item.change, {
        kind: "failed",
        message: `Couldn't send: ${errorMessage(cause)}`,
      });
    }
  };

  /** Enter on an empty composer sends the first queued follow-up now. */
  const sendNextQueued = (): boolean => {
    const next = nextToSteer(pending, roles);
    if (next === undefined) return false;
    void sendPendingNow(next);
    return true;
  };
  const emptyEnterSteers =
    !disabled &&
    currentViewState.draft === "" &&
    attachments.length === 0 &&
    nextToSteer(pending, roles) !== undefined;

  const canBeginEdit = currentViewState.draft === "" && attachments.length === 0 && !disabled;
  const beginEdit = (item: PendingItem): void => {
    if (!canBeginEdit) return;
    const text = messageDraftText(userMessageText(item.content));
    setPendingEdit({ change: item.change, lane: item.lane, content: item.content });
    setFeedback(undefined);
    setDocument({ text, selectionStart: text.length, selectionEnd: text.length });
    editorRef.current?.focus();
  };
  const cancelEdit = (): void => {
    setPendingEdit(undefined);
    setDocument({ text: "", selectionStart: 0, selectionEnd: 0 });
  };

  const queuedMessageCount = pending.length + unsent.length;
  const queuedMessages =
    queuedMessageCount === 0 ? undefined : (
      <section aria-label="Queued messages" {...stylex.props(trayStyles.surface)}>
        <div {...stylex.props(trayStyles.header)}>
          <span {...stylex.props(trayStyles.title)}>
            {String(queuedMessageCount)} Queued {queuedMessageCount === 1 ? "Message" : "Messages"}
            {emptyEnterSteers && (
              <span {...stylex.props(composerStyles.queueHint)}> · Enter to send</span>
            )}
          </span>
        </div>
        <div {...stylex.props(trayStyles.list, composerStyles.queueList)}>
          {pending.map((item) => {
            const action = rowActions.get(item.change);
            const editingThis = activePendingEdit?.change === item.change;
            const busyRow = action?.kind === "cancelling" || action?.kind === "sending";
            const steering = item.lane === roles.steer;
            return (
              <div
                role="status"
                key={item.change}
                data-editing={editingThis}
                data-error={action?.kind === "failed"}
                {...stylex.props(composerStyles.queueRow)}
              >
                <div {...stylex.props(composerStyles.queueMessage)}>
                  <QueuedMessageContent content={item.content} />
                  {action?.kind === "cancelling" && (
                    <span {...stylex.props(composerStyles.queuedState)}>Cancelling…</span>
                  )}
                  {action?.kind === "sending" && (
                    <span {...stylex.props(composerStyles.queuedState)}>Sending…</span>
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
                    <IconButton
                      icon="pencil"
                      label={
                        canBeginEdit
                          ? "Edit queued message"
                          : "Send or clear your draft to edit this"
                      }
                      size={12}
                      disabled={!canBeginEdit}
                      onClick={() => beginEdit(item)}
                    />
                    {!steering && (
                      <IconButton
                        icon="arrow-up"
                        label="Send now"
                        size={14}
                        onClick={() => void sendPendingNow(item)}
                      />
                    )}
                    <IconButton
                      icon="trash"
                      label="Remove queued message"
                      size={12}
                      onClick={() => void cancelPending(item)}
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
              data-error={row.state.kind === "failed"}
              {...stylex.props(composerStyles.queueRow)}
            >
              <div {...stylex.props(composerStyles.queueMessage)}>
                <QueuedMessageContent content={row.content} />
                <span
                  {...stylex.props(
                    composerStyles.queuedState,
                    row.state.kind === "failed" && composerStyles.queuedError,
                  )}
                >
                  {unsentStateText(row.state)}
                </span>
              </div>
              <div {...stylex.props(composerStyles.queueActions)}>
                <IconButton
                  icon="trash"
                  label="Remove unsent message"
                  size={12}
                  onClick={() => outbox.cancel(row.key)}
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
          <Icon name="chevron-down" size={13} />
        </Button>
      )}
      <div role="region" aria-label="Conversation input" {...stylex.props(composerStyles.region)}>
        {feedback !== undefined && (
          <div
            role={feedback.kind === "error" ? "alert" : "status"}
            {...stylex.props(composerStyles.queued)}
          >
            <Icon name={feedback.kind === "error" ? "bubble-question" : "sparkle"} size={12} />
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
            <IconButton icon="x" label="Dismiss" size={12} onClick={() => setFeedback(undefined)} />
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
          disabled={disabled}
          busy={working}
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
            activePendingEdit === undefined
              ? undefined
              : { kind: "queued", lane: activePendingEdit.lane, onCancel: cancelEdit }
          }
        />
      </div>
    </div>
  );
}
