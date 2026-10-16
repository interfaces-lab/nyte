import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
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
 * cancel, and steer actions. Enter on an empty composer steers with the first,
 * and Esc requests a durable abort.
 */
import { trayStyles } from "../theme/tray.stylex.ts";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DragEvent, KeyboardEvent, ReactElement, ReactNode } from "react";
import type { CommandInfo, Delivery, Execution, SessionId, UserContent } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { errorMessage } from "../errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import {
  useCatalog,
  COMPACT_COMMAND,
  useConfigureSession,
  useHostLink,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  useSessionActions,
  useSessionChoice,
  useSessionActivity,
  useSessionCommands,
  useSetPreference,
} from "../queries.ts";
import { pickerDefaults } from "../preference-projection.ts";
import { connection } from "../sdk.tsx";
import type { UserMessage } from "../view-helpers.ts";
import { macPlatform } from "../platform.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "../layout/session-view-state.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import { ModelPicker, type ModelPickerChange } from "./model-picker.tsx";
import { modelRefFor, selectedModelOption } from "./model-picker-state.ts";
import { ImagePreview } from "./image-preview.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor.tsx";
import { composerSource, useComposerSuggestions } from "./composer-suggestions.tsx";
import type { ComposerMentionFiles, ComposerSuggestionCatalog } from "./composer-suggestions.tsx";
import {
  bindComposerFileDrop,
  carriesFiles,
  carriesTreeFiles,
  droppedTreeFiles,
} from "./composer-file-drop.ts";
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
import {
  composerMessageContent,
  composerSendPlan,
  sendComposerMessage,
  uploadComposerContent,
} from "./composer-send.ts";
import {
  UserMessageText,
  messageFiles,
  messageImages,
  userMessageText,
} from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import { parsePluginCommand } from "./plugin-command.ts";
import type { MessageReference } from "./message-references.ts";
import { preferences, useSetting, type RunningMessagePreference } from "../preferences/index.ts";
import { StatusDot } from "../components/ui.tsx";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { composerStyles, markerStyles } from "./styles.stylex.ts";
import { TranscriptButton, useTranscriptControls, useTranscriptDock } from "./transcript.tsx";
import { QuestionDockContext, useQuestionDock } from "./tray/questions-state.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";

const DROP_PLACEHOLDER = "Drop here to attach…";

/** Measured on the composer frame, which sits inside the conversation gutters, not the pane. */
const COMPACT_FRAME_WIDTH = 320;

const NO_COMMANDS: readonly CommandInfo[] = [];

type ComposerSurface = "new-chat" | "follow-up";

type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

const SessionModelChip = memo(function SessionModelChip({
  sessionId,
}: {
  sessionId: SessionId;
}): ReactElement | null {
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);
  const configure = useConfigureSession(sessionId);
  const options = catalog.data?.models ?? [];
  const selected = selectedModelOption(options, choice?.model);
  const current = selected?.option;
  const setPreference = useSetPreference();
  const thinkingLevel = choice?.thinking;

  const handleChange = useCallback(
    (change: ModelPickerChange) => {
      const model = pickerDefaults(
        { model: current, thinkingLevel, fast: selected?.fast === true },
        change,
      );

      if (model !== undefined) setPreference.mutate(model);

      switch (change.kind) {
        case "model":
          configure.mutate({
            model: { provider: change.option.provider, id: change.option.id },
            thinking: change.thinkingLevel,
          });

          return;
        case "thinking":
          configure.mutate({ thinking: change.thinkingLevel });

          return;
        case "fast":
          if (current !== undefined)
            configure.mutate({ model: modelRefFor(current, change.enabled) });

          return;
        default: {
          const _exhaustive: never = change;

          return _exhaustive;
        }
      }
    },
    [configure, current, selected?.fast, setPreference, thinkingLevel],
  );

  return (
    <>
      <ModelPicker
        catalog={catalog.data}
        current={current}
        thinkingLevel={thinkingLevel}
        fast={selected?.fast === true}
        loading={catalog.isPending}
        disabled={catalog.isError}
        onChange={handleChange}
      />
      {catalog.isError && (
        <Button size="sm" onClick={() => void catalog.refetch()} loading={catalog.isFetching}>
          Retry Models
        </Button>
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
  disabled?: boolean;
  /** A run is live: empty-input Esc and the stop button both request an abort. */
  busy?: boolean;
  /** The abort is asked and not yet settled; Stop draws but takes no second request. */
  stopping?: boolean;
  onAbort?: () => void;
  /** An open composer tray handles Escape before the empty-input abort shortcut. */
  onDismissTray?: () => boolean;
  floating?: boolean;
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
  /** Enter answers a waiting question rather than sending a message. */
  answering?: boolean;
}

/** The frame both composers share: autosizing inline editor and shared controls. */
export function ComposerFrame({
  surface,
  document,
  onDocumentChange,
  onSubmit,
  placeholder,
  disabled = false,
  busy = false,
  stopping = false,
  onAbort,
  onDismissTray,
  floating = false,
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
  runningMessagePreference = "steer",
  answering = false,
}: ComposerFrameProps): ReactElement {
  const frameRef = useRef<HTMLFormElement>(null);
  const areaRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const host = useHostState();
  const [dragging, setDragging] = useState<"files" | "mention">();
  const [editorNeedsExpansion, setEditorNeedsExpansion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [focused, setFocused] = useState(false);
  const [references, setReferences] = useState<readonly MessageReference[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const commandsEnabled =
    !answering && surface === "follow-up" && editing === undefined && attachments.length === 0;

  const suggestionMenu = useComposerSuggestions({
    editorRef: areaRef,
    anchorRef: frameRef,
    side: surface === "new-chat" ? "bottom" : "top",
    suggestionCatalog,
    mentionFiles,
    hasConversationContext,
    references,
    onCommand: commandsEnabled ? () => void submit("submit") : undefined,
  });

  const roles = useMemo(() => deliveryChoices, []);
  const canAttach = onFilesSelected !== undefined;

  const dropKind = (event: DragEvent): "files" | "mention" | undefined => {
    if (disabled) return undefined;

    if (canAttach && carriesFiles(event)) return "files";

    return carriesTreeFiles(event) ? "mention" : undefined;
  };

  const hasInstructionChip = references.some((reference) => reference.kind !== "mention");
  const hasSubmission = document.text.trim() !== "" || attachments.length > 0 || hasInstructionChip;
  const canSubmit = !disabled && !submitting && !attachmentBusy && hasSubmission;
  // A sent message edits in the bubble's own geometry: text above the controls, never a compact row.
  const messageEdit = editing?.kind === "message";
  const collapsed = surface === "follow-up" && narrow && !focused && !messageEdit;

  const geometry: ComposerGeometry =
    surface === "new-chat"
      ? "new-chat"
      : (editorNeedsExpansion || messageEdit) && !collapsed
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

  const sendLabel = answering ? "Send answer" : "Send message";

  const sendTitle =
    editing?.kind === "queued"
      ? busy
        ? "Update and Interrupt (Enter)"
        : editing.delivery === roles.steer
          ? `Update (Enter) · Queue Instead (${modifier}Enter)`
          : `Update (Enter) · Steer Instead (${modifier}Enter)`
      : editing?.kind === "message"
        ? "Send Edited Message (Enter)"
        : answering
          ? "Send answer (Enter)"
          : busy
            ? runningMessagePreference === "queue"
              ? `Queue (Enter) · Steer (${modifier}Enter)`
              : `Steer (Enter) · Queue (${modifier}Enter)`
            : "Send Message (Enter)";

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

      const typography = getComputedStyle(area);

      const contentHeight =
        area.scrollHeight -
        Number.parseFloat(typography.paddingTop) -
        Number.parseFloat(typography.paddingBottom);

      if (contentHeight > Number.parseFloat(typography.lineHeight) * 1.5) {
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
        {...props(
          composerStyles.attachments,
          composerStyles.attachmentsInset,
          surface === "new-chat" && composerStyles.attachmentsNewChat,
          compact && composerStyles.attachmentsInsetCompact,
          messageEdit && composerStyles.attachmentsMessageEdit,
        )}
      >
        {attachments.map((attachment) => (
          <li key={attachment.id} {...props(surfaceTheme.gray, composerStyles.attachment)}>
            <ImagePreview
              src={`data:${attachment.content.mimeType};base64,${attachment.content.data}`}
              name={attachment.name}
              compact={!messageEdit}
            />
            {onAttachmentRemove !== undefined && (
              <span {...props(composerStyles.attachmentRemove)}>
                <Button
                  size="2xs"
                  variant="solid"
                  xstyle={composerStyles.pillButton}
                  iconOnly
                  icon="x"
                  aria-label={`Remove ${attachment.name}`}
                  disabled={disabled}
                  onClick={() => onAttachmentRemove(attachment.id)}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  const attachmentAlert =
    collapsed || attachmentError === undefined ? undefined : (
      <div
        role="alert"
        {...props(
          text.sm,
          intent.danger,
          composerStyles.attachmentError,
          composerStyles.attachmentErrorInset,
          surface === "new-chat" &&
            attachments.length === 0 &&
            composerStyles.attachmentErrorNewChat,
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
          setDragging(dropKind(event));
        }}
        onDragOver={(event) => {
          event.preventDefault();
          const kind = dropKind(event);
          // A tree drag only allows "move".
          event.dataTransfer.dropEffect =
            kind === "files" ? "copy" : kind === "mention" ? "move" : "none";

          if (kind !== undefined) setDragging(kind);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;

          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragging(undefined);
        }}
        onDropCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(undefined);

          if (disabled) return;

          if (canAttach && carriesFiles(event)) {
            onFilesSelected(Array.from(event.dataTransfer.files));

            return;
          }

          const files = droppedTreeFiles(event);

          if (files.length > 0)
            areaRef.current?.dropReferences(
              files.map((file) => ({ kind: "file", file })),
              event.clientX,
              event.clientY,
            );
        }}
        onDragEnd={() => setDragging(undefined)}
        {...props(
          dragging && intent.primary,
          composerStyles.frame,
          floating && composerStyles.frameFloating,
          geometry === "new-chat" && composerStyles.frameNewChat,
          compact && composerStyles.frameFollowUpCompact,
          followUpCard && composerStyles.frameFollowUpExpanded,
          messageEdit && composerStyles.frameMessageEdit,
          dragging && composerStyles.frameDragging,
        )}
      >
        {/* A mention lands on the text under the pointer, so only files get the guard. */}
        {dragging === "files" && <span aria-hidden="true" {...props(composerStyles.dropGuard)} />}
        {canAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={disabled}
            tabIndex={-1}
            {...props(composerStyles.fileInput)}
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
          {...props(
            composerStyles.layout,
            geometry === "new-chat" && composerStyles.layoutNewChat,
            compact && composerStyles.layoutCompact,
          )}
        >
          <div {...props(composerStyles.editor, compact && composerStyles.editorCompact)}>
            <ComposerEditor
              ref={areaRef}
              inputRef={inputRef}
              className={
                props(
                  composerStyles.input,
                  geometry === "new-chat" && composerStyles.inputNewChat,
                  geometry === "new-chat" &&
                    (attachments.length > 0 || attachmentError !== undefined) &&
                    composerStyles.inputNewChatAttached,
                  compact && composerStyles.inputCompact,
                  collapsed && composerStyles.editorCollapsed,
                  followUpExpanded && composerStyles.editorExpanded,
                  messageEdit && composerStyles.editorMessageEdit,
                ).className
              }
              files={suggestionMenu.files}
              combobox={answering ? undefined : suggestionMenu.combobox}
              placeholder={dragging === "files" ? DROP_PLACEHOLDER : placeholder}
              document={document}
              disabled={disabled}
              onReferencesChange={setReferences}
              onDocumentChange={(next, completion) => {
                onDocumentChange(next);
                resize(next.text);
                suggestionMenu.onCompletionChange(answering ? undefined : completion);
              }}
              onFilesSelected={onFilesSelected}
              onFocusChange={onFocusChange}
              onKeyDown={(event) => {
                if (!answering && suggestionMenu.onKeyDown(event)) return;
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
          {!answering && suggestionMenu.menu}
          <div
            {...props(
              composerStyles.controls,
              geometry === "new-chat" && composerStyles.controlsNewChat,
              compact && composerStyles.controlsCompact,
              followUpExpanded && composerStyles.controlsInset,
            )}
          >
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    iconOnly
                    icon="plus"
                    aria-label="Add to message"
                    variant="outline"
                    disabled={disabled || answering}
                    xstyle={[composerStyles.pillButton, compact && composerStyles.addButtonCompact]}
                  />
                }
              />
              <MenuContent
                xstyle={composerStyles.addMenu}
                finalFocus={() => areaRef.current?.element}
              >
                <MenuItem
                  icon={commandsEnabled ? "command" : "skills"}
                  meta="/"
                  onClick={() => suggestionMenu.insertTrigger("/")}
                >
                  {commandsEnabled ? "Commands and skills" : "Skills"}
                </MenuItem>
                <MenuItem icon="more" meta="@" onClick={() => suggestionMenu.insertTrigger("@")}>
                  Mention Context
                </MenuItem>
                {canAttach && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon="paperclip" onClick={() => fileInputRef.current?.click()}>
                      Attach Files…
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
            <span {...props(composerStyles.modelSlot, compact && composerStyles.modelSlotCompact)}>
              {model}
            </span>
            <span {...props(composerStyles.spacer, compact && composerStyles.spacerCompact)} />
            <span {...props(composerStyles.sendActions, compact && composerStyles.sendCompact)}>
              {busy && onAbort !== undefined && (
                <Button
                  iconOnly
                  icon="square"
                  aria-label="Stop response"
                  title="Stop response (Esc)"
                  variant="solid"
                  tone="primary"
                  xstyle={composerStyles.pillButton}
                  disabled={disabled}
                  loading={stopping}
                  onClick={onAbort}
                />
              )}
              {(!busy || onAbort === undefined || hasSubmission || submitting) && (
                <Button
                  iconOnly
                  icon="arrow-up"
                  aria-label={sendLabel}
                  title={sendTitle}
                  type="submit"
                  variant="solid"
                  tone="primary"
                  xstyle={composerStyles.pillButton}
                  disabled={disabled || attachmentBusy || !hasSubmission}
                  loading={submitting}
                />
              )}
            </span>
          </div>
        </div>
      </form>
    </>
  );
}

function QueuedMessageContent({ content }: { readonly content: UserContent }): ReactElement {
  const text = userMessageText(content);

  if (text === "") {
    const imageCount = messageImages(content).length;
    const summary = imageCount === 1 ? "1 image" : `${String(imageCount)} images`;

    return (
      <span title={summary} {...props(composerStyles.queuePreview)}>
        {summary}
      </span>
    );
  }

  return (
    <span title={text} {...props(composerStyles.queuePreview)}>
      <UserMessageText text={text} />
    </span>
  );
}

interface ComposerFeedback {
  readonly kind: "status" | "command" | "error";
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
  readonly message: UserMessage;
  readonly delivery: Delivery;
}

function messageReceipt(sessionId: SessionId, message: UserMessage) {
  return connection().session(sessionId).receipt(asId<"receipt">(message.id));
}

function draftWith(document: ComposerDocumentState, text: string): ComposerDocumentState {
  const joined = document.text === "" ? text : `${text}\n${document.text}`;

  return { text: joined, selectionStart: joined.length, selectionEnd: joined.length };
}

export function Composer({
  sessionId,
  execution,
  pending,
  unsent,
  disabled = false,
  initialViewState = DEFAULT_COMPOSER_VIEW_STATE,
  onViewStateChange,
  inputRef,
  fileDropRoot,
  backgroundWork,
  floatingMount = null,
}: {
  sessionId: SessionId;
  execution: Execution | undefined;
  pending: readonly UserMessage[];
  unsent: readonly UserMessage[];
  disabled?: boolean;
  /**
   * The draft to start from. The composer owns the draft while mounted and
   * reports each change; a keystroke must not re-render the transcript behind
   * it, so the parent persists without redrawing. Remount (key) to reseed.
   */
  initialViewState?: ComposerViewState;
  onViewStateChange?: (state: ComposerViewState) => void;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  fileDropRoot?: HTMLElement | null;
  backgroundWork?: {
    readonly content: ReactNode;
    readonly onEscape: () => boolean;
  };
  floatingMount?: HTMLDivElement | null;
}): ReactElement {
  const runningMessagePreference = useSetting(preferences.runningMessage);
  const attachTranscriptDock = useTranscriptDock();
  const transcript = useTranscriptControls();
  const [currentViewState, setCurrentViewState] = useState(initialViewState);
  const attachments = currentViewState.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [feedback, setFeedback] = useState<ComposerFeedback>();
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const liveRun = execution === undefined || execution.kind === "idle" ? undefined : execution.run;
  const stopping = execution?.kind === "live" && execution.stopping;

  const [pendingEdit, setPendingEdit] = useState<PendingEdit>();
  const [activeQueued, setActiveQueued] = useState<string>();
  const host = useHostState();
  const link = useHostLink();
  const queueRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ComposerEditorHandle | null>(null);

  const questions = useQuestionDock(sessionId);

  const pluginCatalog = usePluginCatalog(sessionId);
  const sessionCommands = useSessionCommands(sessionId);
  const sessionActions = useSessionActions();

  const floating = floatingMount !== null;

  const [portalHost] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";

    return element;
  });

  const inlineSlot = useRef<HTMLDivElement | null>(null);
  const focusAfterMove = useRef(false);
  const cwd = host.data?.workspace?.path;

  const activity = useSessionActivity(floating ? sessionId : undefined, cwd);

  const attachInlineSlot = useCallback(
    (slot: HTMLDivElement | null): void => {
      inlineSlot.current = slot;

      if (slot === null) {
        portalHost.remove();

        return;
      }

      slot.append(portalHost);
    },
    [portalHost],
  );

  useLayoutEffect(() => {
    const destination = floatingMount ?? inlineSlot.current;

    if (destination === null || portalHost.parentElement === destination) return;
    destination.append(portalHost);

    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    editorRef.current?.focus({ preventScroll: true });
  }, [floatingMount, portalHost]);

  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);

  // A thread always has an open project behind it.
  const workspaceFiles = useMentionFiles(true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const roles = useMemo(() => deliveryChoices, []);
  // Sends settle later than the render that started them; they read the draft as it is then.
  const latestViewState = useRef(currentViewState);

  const updateViewState = useCallback(
    (update: (current: ComposerViewState) => ComposerViewState): void => {
      const next = update(latestViewState.current);
      latestViewState.current = next;
      setCurrentViewState(next);
      onViewStateChange?.(next);
    },
    [onViewStateChange],
  );

  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef?.(handle);
    },
    [inputRef],
  );

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      setAttachmentReads((count) => count + 1);

      return attachComposerFiles({ files, editor: editorRef.current })
        .then((result) => {
          if (result.attachments.length > 0) {
            updateViewState((current) => ({
              ...current,
              attachments: [...current.attachments, ...result.attachments],
            }));
          }

          setAttachmentError(result.error);
        })
        .finally(() => setAttachmentReads((count) => count - 1));
    },
    [updateViewState],
  );

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

  const setRowAction = (change: string, action: PendingRowAction): void => {
    setRowActions((current) => {
      const shown = new Set<string>(pending.map((item) => item.id));
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
          attachments: [...sent.attachments, ...current.attachments],
          selectionStart: document.selectionStart,
          selectionEnd: document.selectionEnd,
        };
      });
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
    if (disabled || attachmentReads !== 0) return false;
    const sentAttachments = attachments;

    if (/^\/\S/.test(submission.text.trim()) && sessionCommands.data === undefined) {
      setFeedback({ kind: "error", message: "Commands are still loading. Try again." });

      return false;
    }

    const plan = composerSendPlan({
      submission,
      attachments: sentAttachments,
      commands: edit === undefined ? (sessionCommands.data ?? NO_COMMANDS) : NO_COMMANDS,
      delivery,
    });

    if (plan.kind === "empty") return false;

    // A known command's line never reaches the model just because it cannot run here.
    const unavailable =
      plan.kind === "message"
        ? parsePluginCommand(submission.text, sessionCommands.data ?? NO_COMMANDS)
        : undefined;

    if (unavailable !== undefined) {
      const active = sessionCommands.data?.some((command) => command.name === unavailable.name);

      setFeedback({
        kind: "error",
        message:
          active !== true
            ? `/${unavailable.name} isn't available in this chat.`
            : edit === undefined
              ? `Send /${unavailable.name} by itself.`
              : "Commands can't run from a queued message.",
      });

      return false;
    }

    const sent = { document, attachments: sentAttachments };
    // Clear at once: the outbox row already shows the message, and the next thought never waits.
    updateViewState((current) => ({
      ...current,
      draft: "",
      attachments: current.attachments.filter(
        (attachment) => !sentAttachments.includes(attachment),
      ),
      selectionStart: 0,
      selectionEnd: 0,
    }));
    setAttachmentError(undefined);
    setFeedback(undefined);

    if (edit !== undefined) {
      try {
        const content = await uploadComposerContent(
          composerMessageContent(
            submission.text.trim(),
            sentAttachments,
            messageFiles(edit.message.content),
          ),
        );

        await connection().session(sessionId).send(content, { replace: edit.message.id, delivery });
        setPendingEdit(undefined);

        return true;
      } catch (cause: unknown) {
        refuse(`Couldn't update the message: ${errorMessage(cause)}`, sent);

        return false;
      }
    }

    if (plan.kind === "command" && plan.command.name === COMPACT_COMMAND.name) {
      try {
        const outcome = await connection()
          .session(sessionId)
          .compact(plan.command.argument === "" ? {} : { instructions: plan.command.argument });

        switch (outcome.kind) {
          case "started":
            return true;
          case "nothing-to-compact":
            setFeedback({ kind: "command", message: "Nothing to compact" });

            return true;
          case "busy":
            refuse("Wait for the current run before compacting.", sent);

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

    if (plan.kind === "command") {
      try {
        const outcome = await connection()
          .session(sessionId)
          .command(
            plan.command.name,
            plan.command.argument === "" ? undefined : plan.command.argument,
          );

        switch (outcome.kind) {
          case "ran":
            setFeedback(
              outcome.output === null ? undefined : { kind: "command", message: outcome.output },
            );

            return true;
          case "sent":
            return true;
          case "unknown":
            refuse(`/${plan.command.name} isn't available in this chat.`, sent);

            return false;
          case "invalid":
            refuse(
              outcome.issues[0]?.message ?? `/${plan.command.name} needs other arguments.`,
              sent,
            );

            return false;
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

    try {
      await sendComposerMessage(sessionId, plan);

      return true;
    } catch (cause: unknown) {
      refuse(`Couldn't send the message: ${errorMessage(cause)}`, sent);

      return false;
    }
  };

  const send = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    const sent = await deliver(submission, delivery, document, pendingEdit);

    if (sent) {
      sessionActions.restore(sessionId);
      transcript.end();
    }

    return sent;
  };

  const abort = (): void => {
    if (disabled || liveRun === undefined || stopping) return;
    connection()
      .session(sessionId)
      .run(liveRun.id)
      .stop()
      .catch(() => undefined);
  };

  const cancelPending = async (item: UserMessage): Promise<void> => {
    setRowAction(item.id, { kind: "cancelling" });

    try {
      await messageReceipt(sessionId, item).stop();
    } catch (cause: unknown) {
      setRowAction(item.id, { kind: "failed", message: `Couldn't cancel: ${errorMessage(cause)}` });
    }
  };

  const sendPendingNow = async (item: UserMessage): Promise<void> => {
    setRowAction(item.id, { kind: "sending" });

    try {
      await connection()
        .session(sessionId)
        .send(item.content, { replace: item.id, delivery: roles.steer });
    } catch (cause: unknown) {
      setRowAction(item.id, { kind: "failed", message: `Couldn't send: ${errorMessage(cause)}` });
    }
  };

  // The first queued follow-up is the one Enter adds. While it is mid-action,
  // Enter waits rather than reaching past it and reordering the queue.
  const nextQueued = nextToSteer(pending, roles);
  const nextQueuedAction = nextQueued === undefined ? undefined : rowActions.get(nextQueued.id);

  const nextIdleQueued =
    nextQueuedAction === undefined || nextQueuedAction.kind === "failed" ? nextQueued : undefined;

  const sendNextQueued = (): boolean => {
    if (nextIdleQueued === undefined) return false;
    void sendPendingNow(nextIdleQueued);

    return true;
  };

  const emptyEnterSteers =
    questions === undefined &&
    !disabled &&
    currentViewState.draft === "" &&
    attachments.length === 0 &&
    nextIdleQueued !== undefined;

  const canBeginEdit =
    questions === undefined &&
    currentViewState.draft === "" &&
    attachments.length === 0 &&
    pendingEdit === undefined &&
    !disabled;

  const queuedEditReason =
    canBeginEdit || disabled || questions !== undefined
      ? undefined
      : pendingEdit !== undefined
        ? "Finish editing the queued message first."
        : "Send or clear your draft to edit this message.";

  const beginEdit = (item: UserMessage): void => {
    if (!canBeginEdit || item.source.kind === "action") return;
    const text = messageDraftText(userMessageText(item.content));
    setPendingEdit({ message: item, delivery: item.delivery });
    setFeedback(undefined);
    updateViewState((current) => ({
      ...current,
      draft: text,
      attachments: [],
      selectionStart: text.length,
      selectionEnd: text.length,
    }));
    editorRef.current?.focus();
  };

  const clearEdit = (): void => {
    setPendingEdit(undefined);
    setAttachmentError(undefined);
    updateViewState((current) => ({
      ...current,
      draft: "",
      attachments: [],
      selectionStart: 0,
      selectionEnd: 0,
    }));
  };

  const cancelEdit = clearEdit;

  /** A row action that holds focus hands it to the editor before its button goes away. */
  const releaseFocus = (button: Element): void => {
    if (button === document.activeElement) editorRef.current?.focus({ preventScroll: true });
  };

  const removeOutboxRow = (row: UserMessage): void => {
    messageReceipt(sessionId, row)
      .stop()
      .catch((cause: unknown) => {
        setFeedback({
          kind: "error",
          message: `Couldn't remove the message: ${errorMessage(cause)}`,
        });
      });
  };

  const sendOutboxRowNow = (row: UserMessage): void => {
    void connection()
      .session(sessionId)
      .send(row.content, { replace: row.id, delivery: roles.steer })
      .catch((cause: unknown) => {
        setFeedback({ kind: "error", message: `Couldn't send: ${errorMessage(cause)}` });
      });
  };

  const queueKeys: readonly string[] = [
    ...pending.map((item) => item.id),
    ...unsent.map((row) => row.id),
  ];

  const focusedQueueKey =
    activeQueued !== undefined && queueKeys.includes(activeQueued) ? activeQueued : queueKeys[0];

  const queueDeleteKey = macPlatform(host.data?.platform) ? "Meta+Backspace" : "Control+Delete";

  const queueKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: UserMessage,
    unsentRow: boolean,
  ): void => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const rows = [...(queueRef.current?.querySelectorAll("[data-queue-row]") ?? [])];
      const index = rows.indexOf(event.currentTarget);

      const next =
        rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)))];

      if (next instanceof HTMLElement) next.focus({ preventScroll: true });

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      editorRef.current?.focus({ preventScroll: true });

      return;
    }

    if (disabled || event.repeat) return;

    const editingThis = pendingEdit?.message.id === item.id;
    const action = rowActions.get(item.id);

    if (editingThis || action?.kind === "sending" || action?.kind === "cancelling") return;

    const remove = macPlatform(host.data?.platform)
      ? event.metaKey && event.key === "Backspace"
      : event.ctrlKey && event.key === "Delete";

    if (remove) {
      event.preventDefault();
      editorRef.current?.focus({ preventScroll: true });

      if (unsentRow) removeOutboxRow(item);
      else void cancelPending(item);

      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

    if (event.key === "Enter") {
      event.preventDefault();
      editorRef.current?.focus({ preventScroll: true });

      if (unsentRow) sendOutboxRowNow(item);
      else if (item.delivery !== roles.steer) void sendPendingNow(item);

      return;
    }

    if (event.key === " " || event.key === "ArrowRight") {
      event.preventDefault();

      if (queuedEditReason !== undefined) {
        setFeedback({ kind: "status", message: queuedEditReason });

        return;
      }

      beginEdit(item);
    }
  };

  const queuedMessageCount = pending.length + unsent.length;

  const queuedMessages =
    queuedMessageCount === 0 ? undefined : (
      <section aria-label="Queued messages" {...props(trayStyles.surface)}>
        <div {...props(trayStyles.header)}>
          <span {...props(trayStyles.title)}>
            {String(queuedMessageCount)} queued {queuedMessageCount === 1 ? "message" : "messages"}
            {emptyEnterSteers && (
              <span {...props(composerStyles.queueHint)}> · Enter to steer</span>
            )}
          </span>
        </div>
        <div ref={queueRef} role="list" {...props(trayStyles.list, composerStyles.queueList)}>
          {pending.map((item) => {
            const action = rowActions.get(item.id);
            const editingThis = pendingEdit?.message.id === item.id;

            const busyRow = action?.kind === "cancelling" || action?.kind === "sending";
            const steering = item.delivery === roles.steer;

            return (
              <div
                role="listitem"
                key={item.id}
                data-queue-row={item.id}
                tabIndex={focusedQueueKey === item.id ? 0 : -1}
                aria-keyshortcuts={`ArrowUp ArrowDown Enter Space ArrowRight Escape ${queueDeleteKey}`}
                aria-description={`Enter sends now. Space or Right Arrow edits. ${macPlatform(host.data?.platform) ? "Command+Backspace" : "Ctrl+Delete"} removes. Escape returns to the composer.`}
                onFocus={() => setActiveQueued(item.id)}
                onKeyDown={(event) => queueKeyDown(event, item, false)}
                data-editing={editingThis}
                data-error={action?.kind === "failed"}
                {...props(composerStyles.queueRow)}
              >
                <div {...props(composerStyles.queueMessage)}>
                  <QueuedMessageContent
                    content={item.source.kind === "action" ? item.source.label : item.content}
                  />
                  {action?.kind === "cancelling" && (
                    <span {...props(text.xs, composerStyles.queuedState)}>Cancelling…</span>
                  )}
                  {action?.kind === "failed" && (
                    <span
                      role="alert"
                      {...props(
                        text.xs,
                        intent.danger,
                        composerStyles.queuedState,
                        composerStyles.queuedError,
                      )}
                    >
                      {action.message}
                    </span>
                  )}
                </div>
                {!busyRow && !editingThis && (
                  <div {...props(composerStyles.queueActions)}>
                    {item.source.kind !== "action" && (
                      <Button
                        iconOnly
                        icon="pencil"
                        aria-label="Edit queued message"
                        disabled={!canBeginEdit}
                        disabledReason={queuedEditReason}
                        onClick={() => beginEdit(item)}
                      />
                    )}
                    {!steering && (
                      <Button
                        iconOnly
                        icon="arrow-up"
                        aria-label="Add to next response"
                        onClick={(event) => {
                          releaseFocus(event.currentTarget);
                          void sendPendingNow(item);
                        }}
                      />
                    )}
                    <Button
                      iconOnly
                      icon="trash"
                      aria-label="Remove queued message"
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
          {unsent.map((row) => {
            const editingThis = pendingEdit?.message.id === row.id;
            const retrying = row.status.kind === "unsent" ? row.status.retrying : null;

            return (
              <div
                role="listitem"
                key={row.id}
                data-queue-row={row.id}
                tabIndex={focusedQueueKey === row.id ? 0 : -1}
                aria-keyshortcuts={`ArrowUp ArrowDown Enter Space ArrowRight Escape ${queueDeleteKey}`}
                aria-description={`Enter sends now. Space or Right Arrow edits. ${macPlatform(host.data?.platform) ? "Command+Backspace" : "Ctrl+Delete"} removes. Escape returns to the composer.`}
                onFocus={() => setActiveQueued(row.id)}
                onKeyDown={(event) => queueKeyDown(event, row, true)}
                data-editing={editingThis}
                data-error={retrying !== null}
                {...props(composerStyles.queueRow)}
              >
                <div {...props(composerStyles.queueMessage)}>
                  <QueuedMessageContent
                    content={row.source.kind === "action" ? row.source.label : row.content}
                  />
                  {retrying !== null && (
                    <span
                      role="alert"
                      {...props(
                        text.xs,
                        intent.danger,
                        composerStyles.queuedState,
                        composerStyles.queuedError,
                      )}
                    >
                      Couldn't send: {retrying.reason}. Retrying…
                    </span>
                  )}
                </div>
                {!editingThis && (
                  <div {...props(composerStyles.queueActions)}>
                    {row.source.kind !== "action" && row.delivery !== roles.steer && (
                      <Button
                        iconOnly
                        icon="pencil"
                        aria-label="Edit queued message"
                        disabled={!canBeginEdit}
                        disabledReason={queuedEditReason}
                        onClick={() => beginEdit(row)}
                      />
                    )}
                    <Button
                      iconOnly
                      icon="trash"
                      aria-label="Remove queued message"
                      onClick={(event) => {
                        releaseFocus(event.currentTarget);
                        removeOutboxRow(row);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );

  const dock = (
    <div
      ref={attachTranscriptDock}
      {...props(composerStyles.dock, floating && composerStyles.dockFloating)}
    >
      <div
        role="region"
        aria-label="Conversation input"
        {...props(composerStyles.region, floating && composerStyles.regionFloating)}
      >
        <div {...props(composerStyles.inputStack)}>
          <div {...props(composerStyles.preComposerOverlay)}>
            <div {...props(composerStyles.preComposerStack)}>
              {feedback !== undefined && (
                <div
                  role={feedback.kind === "error" ? "alert" : "status"}
                  {...props(composerStyles.queued)}
                >
                  <Icon
                    name={
                      feedback.kind === "error"
                        ? "bubble-question"
                        : feedback.kind === "command"
                          ? "command"
                          : "sparkle"
                    }
                  />
                  <span {...props(composerStyles.queuedText)}>{feedback.message}</span>
                  {feedback.restore !== undefined && (
                    <Button variant="text" onClick={feedback.restore}>
                      Restore Draft
                    </Button>
                  )}
                  <Button
                    iconOnly
                    icon="x"
                    aria-label="Dismiss notification"
                    onClick={() => setFeedback(undefined)}
                  />
                </div>
              )}

              {link !== undefined && link.kind !== "connected" && (
                <div
                  role={link.kind === "closed" ? "alert" : "status"}
                  {...props(composerStyles.queued)}
                >
                  <Icon name={link.kind === "closed" ? "warning" : "refresh"} />
                  <span {...props(composerStyles.queuedText)}>
                    {link.kind === "closed"
                      ? "Disconnected from the host."
                      : "Reconnecting to the host…"}
                  </span>
                </div>
              )}

              {queuedMessages}
            </div>
            <div {...props(composerStyles.preComposerPills)}>
              <QuestionDockContext value={questions}>{backgroundWork?.content}</QuestionDockContext>
              {floating ? (
                <>
                  {liveRun !== undefined && (
                    <span {...props(text.base, composerStyles.floatingStatus)}>
                      <StatusDot mark="working" />
                      <span {...props(composerStyles.floatingStatusText, markerStyles.shimmer)}>
                        {activity ?? "Working"}
                      </span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="chip"
                    onClick={() => {
                      focusAfterMove.current = true;
                      workbenchController.actions.showChat({ view: workbenchViewKey(cwd) });
                    }}
                  >
                    Show Chat
                  </Button>
                </>
              ) : (
                <TranscriptButton />
              )}
            </div>
          </div>
          <ComposerFrame
            surface="follow-up"
            document={
              questions?.document ?? {
                text: currentViewState.draft,
                selectionStart: currentViewState.selectionStart,
                selectionEnd: currentViewState.selectionEnd,
              }
            }
            onDocumentChange={(document) => {
              if (questions !== undefined) {
                questions.changeDocument(document);

                return;
              }

              if (document.text !== latestViewState.current.draft) {
                setFeedback((current) => (current?.kind === "error" ? current : undefined));
              }

              updateViewState((current) => ({
                ...current,
                draft: document.text,
                selectionStart: document.selectionStart,
                selectionEnd: document.selectionEnd,
              }));
            }}
            onSubmit={
              questions === undefined
                ? send
                : async (_submission, _delivery, document) => {
                    try {
                      await questions.advance(document);

                      return true;
                    } catch {
                      return false;
                    }
                  }
            }
            placeholder={
              questions === undefined ? FOLLOW_UP_PLACEHOLDER : "Answer in your own words"
            }
            floating={floating}
            disabled={disabled || questions?.pending === true || questions?.settled === true}
            busy={liveRun !== undefined}
            runningMessagePreference={runningMessagePreference}
            answering={questions !== undefined}
            stopping={stopping}
            onAbort={abort}
            onDismissTray={
              questions === undefined
                ? backgroundWork?.onEscape
                : () => {
                    void questions.dismiss().catch(() => undefined);

                    return true;
                  }
            }
            onEmptySubmit={questions === undefined ? sendNextQueued : undefined}
            suggestionCatalog={
              questions === undefined
                ? suggestionCatalog
                : { status: "ready", data: { commands: [], skills: [] } }
            }
            mentionFiles={questions === undefined ? mentionFiles : { status: "ready", data: [] }}
            hasConversationContext
            attachments={questions === undefined ? attachments : []}
            attachmentBusy={questions === undefined && attachmentReads !== 0}
            attachmentError={questions === undefined ? attachmentError : undefined}
            onFilesSelected={questions === undefined ? (files) => void addFiles(files) : undefined}
            onAttachmentRemove={(id) => {
              updateViewState((current) => ({
                ...current,
                attachments: current.attachments.filter((attachment) => attachment.id !== id),
              }));
              setAttachmentError(undefined);
            }}
            model={
              disabled || questions !== undefined ? undefined : (
                <SessionModelChip sessionId={sessionId} />
              )
            }
            inputRef={attachInput}
            onFocusChange={(focused) => updateViewState((current) => ({ ...current, focused }))}
            editing={
              questions !== undefined || pendingEdit === undefined
                ? undefined
                : { kind: "queued", delivery: pendingEdit.delivery, onCancel: cancelEdit }
            }
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div ref={attachInlineSlot} {...props(composerStyles.portalSlot)} />
      {createPortal(dock, portalHost)}
    </>
  );
}
