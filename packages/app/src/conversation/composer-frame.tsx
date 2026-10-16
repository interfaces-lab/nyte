import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import type { Delivery } from "@nyte-ai/sdk";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import type { RunningMessagePreference } from "../preferences/index.ts";
import { ImagePreview } from "./image-preview.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor.tsx";
import { useComposerSuggestions } from "./composer-suggestions.tsx";
import type { ComposerMentionFiles, ComposerSuggestionCatalog } from "./composer-suggestions.tsx";
import { carriesFiles, carriesTreeFiles, droppedTreeFiles } from "./composer-file-drop.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import {
  composerEnterAction,
  deliveryChoices,
  modifierKeyLabel,
  submissionDelivery,
} from "./composer-keys.ts";
import type { SubmitAction } from "./composer-keys.ts";
import type { MessageReference } from "./message-references.ts";
import { composerStyles } from "./composer.stylex.ts";

const DROP_PLACEHOLDER = "Drop here to attach…";

/** Measured on the composer frame, which sits inside the conversation gutters, not the pane. */
const COMPACT_FRAME_WIDTH = 320;

type ComposerSurface = "new-chat" | "follow-up";

type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

/** What the frame is editing instead of composing anew. */
type ComposerEditing =
  | {
      readonly kind: "queued";
      /** The queued item's delivery: Enter keeps it, the modifier swaps it for the other role. */
      readonly delivery: Delivery;
      readonly onCancel: () => void;
    }
  | {
      /**
       * A sent message: sending branches the conversation from that point. It
       * edits in the bubble's own geometry, text above the controls, never a
       * compact row.
       */
      readonly kind: "message";
      readonly onCancel: () => void;
    };

interface ComposerFrameProps {
  /** Placement is caller intent; the follow-up surface derives its own geometry. */
  readonly surface: ComposerSurface;
  /** The draft to show. The frame reports every edit back; the parent owns the value. */
  document: ComposerDocumentState;
  onDocumentChange: (document: ComposerDocumentState) => void;
  /**
   * The parent clears the exact live document passed here and restores it if
   * the send is refused. It may answer synchronously or with a promise.
   */
  onSubmit: (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ) => boolean | Promise<boolean>;
  placeholder: string;
  disabled?: boolean;
  /** A run is live: Esc and the stop button both request an abort; the draft stays. */
  busy?: boolean;
  /** The abort is asked and not yet settled; Stop draws but takes no second request. */
  stopping?: boolean;
  onAbort?: () => void;
  /** An open composer tray handles Escape before the abort shortcut. */
  onDismissTray?: () => boolean;
  floating?: boolean;
  /**
   * Enter on a truly empty composer, which adds the first queued follow-up to
   * the next response; return true when it was handled.
   */
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

/**
 * The frame both composers share: autosizing inline editor and shared
 * controls. The new-chat field stacks above its controls while the follow-up
 * field is one compact row; attachments stay inside the frame, above the
 * editor. Follow-up text scrolls on one line so the composer stays compact:
 * an explicit line break expands the card, and width alone never makes the
 * controls overflow. A file drag draws a guard over the frame; a mention drag
 * does not, because it lands on the text under the pointer. Submitting chains
 * on the parent's answer rather than using `try`/`finally`, which would cost
 * this component its compiler memoization.
 */
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

  const canAttach = onFilesSelected !== undefined;

  const dropKind = (event: DragEvent): "files" | "mention" | undefined => {
    if (disabled) return undefined;

    if (canAttach && carriesFiles(event)) return "files";

    return carriesTreeFiles(event) ? "mention" : undefined;
  };

  const hasInstructionChip = references.some((reference) => reference.kind !== "mention");
  const hasSubmission = document.text.trim() !== "" || attachments.length > 0 || hasInstructionChip;
  const canSubmit = !disabled && !submitting && !attachmentBusy && hasSubmission;
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

  const modifier = modifierKeyLabel(macPlatform(nyte.platform));

  const sendLabel = answering ? "Send answer" : "Send message";

  const sendTitle =
    editing?.kind === "queued"
      ? busy
        ? "Update and Interrupt (Enter)"
        : editing.delivery === deliveryChoices.steer
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

  const resize = useCallback(
    (text?: string): void => {
      const area = areaRef.current?.readElement();

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
    const area = areaRef.current?.readElement();
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

    return Promise.resolve(
      onSubmit(
        submission,
        submissionDelivery(
          action,
          deliveryChoices,
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

              if (busy && !stopping && onAbort !== undefined) {
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
              finalFocus={() => areaRef.current?.readElement()}
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
  );
}
