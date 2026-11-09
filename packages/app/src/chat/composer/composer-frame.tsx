import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { flushSync } from "react-dom";
import type { CommandCompletion, Delivery } from "@nyte-ai/sdk";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { nyte } from "../../contract/nyte.ts";
import { clientActionAriaShortcut, clientActions } from "../../contract/client-actions.ts";
import type { RunningMessagePreference } from "../../preferences/index.ts";
import { ImagePreview } from "../markdown/image-preview.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor.tsx";
import { useComposerSuggestions } from "./composer-suggestions.tsx";
import type { ComposerMentionFiles, ComposerSuggestionCatalog } from "./composer-suggestions.tsx";
import {
  carriesFiles,
  carriesTreeFiles,
  droppedTreeFiles,
} from "../../references/composer-file-drop.ts";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";
import {
  composerEnterAction,
  enterBehavior,
  recallDirection,
  submissionDelivery,
} from "./composer-keys.ts";
import type { SubmitAction } from "./composer-keys.ts";
import type { RecallDirection } from "./composer-history.ts";
import type { MessageReference } from "../../references/message-references.ts";
import { composerStyles } from "./composer.stylex.ts";
import { ComposerPicker } from "./model-picker.tsx";

const DROP_PLACEHOLDER = "Drop here to attach…";

const COMPACT_FRAME_WIDTH = 320;

export type ComposerSurface = "new-chat" | "follow-up" | "side-chat";

type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

type ComposerEditing =
  | {
      readonly kind: "queued";
      readonly delivery: Delivery;
      readonly onCancel: () => void;
    }
  | {
      readonly kind: "message";
      readonly onCancel: () => void;
    };

interface ComposerFrameProps {
  readonly surface: ComposerSurface;
  document: ComposerDocumentState;
  onDocumentChange: (document: ComposerDocumentState) => void;
  onSubmit: (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ) => void | Promise<void>;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  stopping?: boolean;
  onAbort?: () => void;
  onDismissTray?: () => boolean;
  floating?: boolean;
  onEmptySubmit?: () => boolean;
  onRecall?: (direction: RecallDirection) => boolean;
  model?: ReactNode;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  onFocusChange?: (focused: boolean) => void;
  suggestionCatalog: ComposerSuggestionCatalog;
  completeCommand?: (name: string, prefix: string) => Promise<readonly CommandCompletion[]>;
  mentionFiles: ComposerMentionFiles;
  hasConversationContext?: boolean;
  attachments?: readonly ComposerImageAttachment[];
  attachmentBusy?: boolean;
  attachmentError?: string;
  onFilesSelected?: (files: readonly File[], signal?: AbortSignal) => Promise<string | undefined>;
  onAttachmentRemove?: (id: string) => void;
  editing?: ComposerEditing;
  runningMessagePreference?: RunningMessagePreference;
  answering?: boolean;
}

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
  onRecall,
  model,
  inputRef,
  onFocusChange,
  suggestionCatalog,
  completeCommand,
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

  const [picker] = useState(() => ({
    keyShortcuts: clientActionAriaShortcut(clientActions.selectModel, nyte.platform === "darwin"),
    editor: () => areaRef.current?.readElement(),
  }));

  const commandsEnabled =
    !answering && surface !== "new-chat" && editing === undefined && attachments.length === 0;

  const suggestionMenu = useComposerSuggestions({
    editorRef: areaRef,
    anchorRef: frameRef,
    side: surface === "new-chat" || editing?.kind === "message" ? "bottom" : "top",
    suggestionCatalog,
    mentionFiles,
    hasConversationContext,
    references,
    onCommand: commandsEnabled ? () => void submit("submit") : undefined,
    completeCommand,
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
  const collapsed = surface !== "new-chat" && narrow && !focused && !messageEdit && !submitting;

  const geometry: ComposerGeometry =
    surface === "new-chat"
      ? "new-chat"
      : (editorNeedsExpansion || messageEdit) && !collapsed
        ? "follow-up-expanded"
        : "follow-up-compact";

  const compact = geometry === "follow-up-compact";
  const sideChat = surface === "side-chat";
  const label = sideChat ? "Side chat message" : "Message";
  const followUpExpanded = geometry === "follow-up-expanded";

  const followUpCard =
    surface !== "new-chat" &&
    !collapsed &&
    (followUpExpanded ||
      attachments.length > 0 ||
      attachmentError !== undefined ||
      editing !== undefined);

  const send = enterBehavior(
    editing?.kind === "queued"
      ? { kind: "editing-queued", delivery: editing.delivery }
      : editing?.kind === "message"
        ? { kind: "editing-message" }
        : answering
          ? { kind: "answering" }
          : busy
            ? { kind: "running", preference: runningMessagePreference }
            : { kind: "idle" },
    nyte.platform === "darwin",
  );

  const measureExpansion = (): void => {
    const area = areaRef.current?.readElement();

    if (surface === "new-chat" || area === null || area === undefined) return;

    if (area.textContent.length === 0) {
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
  };

  const resizeEditor = useEffectEvent((): void => measureExpansion());

  // oxlint-disable-next-line nyte-code/no-direct-effect -- observes frame and textarea sizes before paint
  useLayoutEffect(() => {
    const area = areaRef.current?.readElement();
    const frame = frameRef.current;

    if (area === null || area === undefined || frame === null) return undefined;

    const measure = (): void => {
      setNarrow(frame.getBoundingClientRect().width < COMPACT_FRAME_WIDTH);
      resizeEditor();
    };

    measure();
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(area);
    observer.observe(frame);

    return () => observer.disconnect();
  }, [surface, editorNeedsExpansion]);

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
      onSubmit(submission, submissionDelivery(action, send.delivery), currentDocument),
    ).finally(() => setSubmitting(false));
  };

  const editingIndicator =
    editing?.kind !== "queued" || collapsed ? undefined : (
      <div
        {...props(
          text.sm,
          composerStyles.editingIndicator,
          compact && composerStyles.editingIndicatorCompact,
        )}
      >
        <Icon name="pencil" size="sm" />
        <span role="status" {...props(composerStyles.queuedText)}>
          Editing queued message
        </span>
        <Button
          size="xs"
          iconOnly
          icon="x"
          aria-label="Cancel editing"
          title="Cancel Editing (Esc)"
          disabled={submitting}
          onClick={editing.onCancel}
        />
      </div>
    );

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
      data-composer-frame={surface}
      ref={frameRef}
      aria-label={label}
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
          void onFilesSelected(Array.from(event.dataTransfer.files));

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
        compact && sideChat && composerStyles.frameSideChatCompact,
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

            if (picked.length > 0) void onFilesSelected(picked);
          }}
        />
      )}
      {editingIndicator}
      {attachmentList}
      {attachmentAlert}
      <div
        {...props(
          composerStyles.layout,
          geometry === "new-chat" && composerStyles.layoutNewChat,
          compact && composerStyles.layoutCompact,
          compact && sideChat && composerStyles.layoutSideChatCompact,
        )}
      >
        <div {...props(composerStyles.editor, compact && composerStyles.editorCompact)}>
          <ComposerEditor
            ref={areaRef}
            inputRef={inputRef}
            label={label}
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
            placeholder={
              dragging === "files" ? DROP_PLACEHOLDER : (send.placeholder ?? placeholder)
            }
            document={document}
            disabled={disabled}
            onReferencesChange={setReferences}
            onDocumentChange={(next, completion) => {
              onDocumentChange(next);

              if (next.text.length === 0) setEditorNeedsExpansion(false);

              suggestionMenu.onCompletionChange(answering ? undefined : completion, next);
            }}
            onFilesSelected={onFilesSelected}
            onFocusChange={onFocusChange}
            onKeyDown={(event) => {
              if (!answering && suggestionMenu.onKeyDown(event)) return;
              const recall = recallDirection(event);

              if (recall !== undefined && onRecall?.(recall) === true) {
                event.preventDefault();

                return;
              }

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

              if (editing !== undefined) {
                event.preventDefault();

                if (submitting) return;
                editing.onCancel();

                return;
              }

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
          {!sideChat && (
            <>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      iconOnly
                      icon="plus"
                      aria-label="Add to message"
                      variant="outline"
                      disabled={disabled || answering}
                      xstyle={[
                        composerStyles.pillButton,
                        compact && composerStyles.addButtonCompact,
                      ]}
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
              <span
                {...props(composerStyles.modelSlot, compact && composerStyles.modelSlotCompact)}
              >
                <ComposerPicker value={editing?.kind === "message" ? undefined : picker}>
                  {model}
                </ComposerPicker>
              </span>
            </>
          )}
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
                aria-label={send.label}
                title={send.title}
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
