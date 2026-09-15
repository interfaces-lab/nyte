/**
 * One transcript item. User prompts are the only ordinary contained message
 * region. Assistant prose stays flat, while reasoning, tools, and system
 * history use compact rows. Parts keep core's stable identity so settled and
 * streaming content exchange in place.
 */
import * as stylex from "@stylexjs/stylex";
import { Button as BaseButton } from "@nyte-ai/ui";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { changesFromTurns, presentNote, turnPartId } from "@nyte-ai/core/views";
import type { FileChange, ThinkingLevel, Turn, TurnPart, UserTurnPart } from "@nyte-ai/core";
import type { RenderedTurn } from "./transcript-rows.ts";
import { filesChangedLabel } from "../workbench/change-tree.ts";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { useMentionFiles, usePluginCatalog } from "../queries.ts";
import { Prose } from "./prose.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerFrame, readComposerImageAttachments } from "./composer.tsx";
import type { ComposerImageAttachment } from "./composer.tsx";
import { composerMessageContent } from "./composer-send.ts";
import { composerSource } from "./composer-suggestions.tsx";
import { ImagePreview } from "./image-preview.tsx";
import { UserMessageText, messageImages, userMessageText } from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import { ModelPicker } from "./model-picker.tsx";
import type { ModelPickerChange } from "./model-picker.tsx";
import { USER_MESSAGE_PREVIEW_LINES, turnStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { WorkGroupView } from "./tool-group.tsx";
import {
  displayTranscriptParts,
  isFailureNotice,
  presentTranscriptNotice,
  userDisplayText,
} from "./transcript-presentation.ts";
import { errorMessage } from "../../../shared/errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../nyte.ts";

function UserMessagePreview({ children }: { children: ReactNode }): ReactElement {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return undefined;
    const measure = (): void => {
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      setOverflowing(content.scrollHeight > lineHeight * USER_MESSAGE_PREVIEW_LINES);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        id={id}
        {...stylex.props(
          turnStyles.userPreview,
          !expanded && turnStyles.userPreviewCollapsed,
          !expanded && overflowing && turnStyles.userPreviewFade,
        )}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflowing && (
        <BaseButton
          unstyled
          type="button"
          aria-controls={id}
          aria-expanded={expanded}
          {...stylex.props(turnStyles.userPreviewToggle, focus.ring)}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show more"}
        </BaseButton>
      )}
    </>
  );
}

function UserMessageImages({ content }: { content: UserTurnPart["content"] }): ReactElement | null {
  const images = messageImages(content);
  if (images.length === 0) return null;
  return (
    <div aria-label="Image attachments" {...stylex.props(turnStyles.userImages)}>
      {images.map((item, index) => (
        <ImagePreview
          key={index}
          src={`data:${item.mimeType};base64,${item.data}`}
          name={`Image ${String(index + 1)}`}
        />
      ))}
    </div>
  );
}

export interface BranchModelChoice {
  readonly model: DesktopModelOption | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly fastEnabled: ReadonlySet<string>;
}

export interface BranchModelPicker extends BranchModelChoice {
  readonly catalog: DesktopCatalog | undefined;
}

type ConversationTurnId = Extract<Turn, { kind: "turn" }>["id"];

export type TurnChangesTarget =
  | { readonly kind: "turn"; readonly turnId: ConversationTurnId }
  | { readonly kind: "file"; readonly turnId: ConversationTurnId; readonly path: string };

interface UserEditState extends BranchModelChoice {
  /** The message as a draft: its head sentences back as chips, edited in the composer's editor. */
  readonly document: ComposerDocumentState;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly attachmentReads: number;
  readonly attachmentError: string | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
}

/** The message's own images become attachments the edit can keep or drop. */
function attachmentsOf(content: UserTurnPart["content"]): readonly ComposerImageAttachment[] {
  return messageImages(content).map((image, index) => ({
    id: crypto.randomUUID(),
    name: `Image ${String(index + 1)}`,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
    content: image,
  }));
}

/**
 * One user row. Without `onEdit` it is read-only, which also draws a message
 * that has left the composer but has no commit yet. Editing is composing
 * again from the sent content, so it is the same frame the composer uses:
 * attachments, the `+` menu, `@` and `/` completion, the model picker.
 */
export function UserMessageView({
  content,
  onEdit,
  branchModel,
}: {
  content: UserTurnPart["content"];
  onEdit?: (content: UserTurnPart["content"], choice: BranchModelChoice) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement {
  const [edit, setEdit] = useState<UserEditState | undefined>();
  const rowRef = useRef<HTMLDivElement>(null);
  const canDismissEdit = edit !== undefined && !edit.saving && edit.attachmentReads === 0;
  useEffect(() => {
    const row = rowRef.current;
    if (!canDismissEdit || row === null) return;
    const dismiss = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.composedPath().includes(row))
        return;
      const target = event.target;
      // Portalled menus and dialogs still belong to the active editing interaction.
      if (
        target instanceof Element &&
        target.closest('[data-composer-frame], [role="menu"], [role="listbox"], [role="dialog"]')
      )
        return;
      setEdit(undefined);
    };
    row.ownerDocument.addEventListener("click", dismiss);
    return () => row.ownerDocument.removeEventListener("click", dismiss);
  }, [canDismissEdit]);
  const original = userMessageText(content);
  const pluginCatalog = usePluginCatalog();
  // The edit sits in a thread, so a workspace is open behind it.
  const workspaceFiles = useMentionFiles(edit !== undefined);

  const begin = (): void => {
    if (onEdit === undefined || edit !== undefined) return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    const text = messageDraftText(original);
    setEdit({
      document: { text, selectionStart: text.length, selectionEnd: text.length },
      attachments: attachmentsOf(content),
      attachmentReads: 0,
      attachmentError: undefined,
      saving: false,
      error: undefined,
      model: branchModel?.model,
      thinkingLevel: branchModel?.thinkingLevel,
      fastEnabled: new Set(branchModel?.fastEnabled),
    });
  };

  const patchEdit = (patch: (current: UserEditState) => UserEditState): void => {
    setEdit((current) => (current === undefined ? current : patch(current)));
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    patchEdit((current) => ({ ...current, attachmentReads: current.attachmentReads + 1 }));
    return readComposerImageAttachments(files)
      .then((result) => {
        patchEdit((current) => ({
          ...current,
          attachments: [...current.attachments, ...result.attachments],
          attachmentError: result.error,
        }));
      })
      .finally(() =>
        patchEdit((current) => ({ ...current, attachmentReads: current.attachmentReads - 1 })),
      );
  };

  const save = async (submission: ComposerSubmission): Promise<boolean> => {
    if (edit === undefined || edit.saving || onEdit === undefined) return false;
    const next = composerMessageContent(
      submission.text.trim(),
      edit.attachments,
      submission.references,
    );
    if (Array.isArray(next) ? next.length === 0 : next.trim() === "") {
      setEdit({ ...edit, error: "A message cannot be empty." });
      return false;
    }
    setEdit({ ...edit, saving: true, error: undefined });
    try {
      await onEdit(next, {
        model: edit.model,
        thinkingLevel: edit.thinkingLevel,
        fastEnabled: edit.fastEnabled,
      });
      setEdit(undefined);
      return true;
    } catch (cause: unknown) {
      patchEdit((current) => ({ ...current, saving: false, error: errorMessage(cause) }));
      return false;
    }
  };

  const modelPicker =
    edit === undefined || branchModel === undefined ? undefined : (
      <ModelPicker
        catalog={branchModel.catalog}
        current={edit.model}
        thinkingLevel={edit.thinkingLevel}
        fastEnabled={edit.fastEnabled}
        disabled={edit.saving}
        onChange={(change: ModelPickerChange) => {
          switch (change.kind) {
            case "model":
              setEdit({ ...edit, model: change.option, thinkingLevel: change.thinkingLevel });
              return;
            case "thinking":
              setEdit({ ...edit, thinkingLevel: change.thinkingLevel });
              return;
            case "fast": {
              const fastEnabled = new Set(edit.fastEnabled);
              if (change.enabled) fastEnabled.add(change.settingId);
              else fastEnabled.delete(change.settingId);
              setEdit({ ...edit, fastEnabled });
              return;
            }
            default: {
              const _exhaustive: never = change;
              return _exhaustive;
            }
          }
        }}
      />
    );

  return (
    <div ref={rowRef} data-sticky-user-message {...stylex.props(turnStyles.userRow)}>
      <div {...stylex.props(turnStyles.userPromptShell)}>
        {edit === undefined ? (
          <div
            {...stylex.props(
              turnStyles.userPrompt,
              onEdit !== undefined && turnStyles.userPromptEditable,
            )}
          >
            <UserMessageImages content={content} />
            <UserMessagePreview>
              {onEdit === undefined ? (
                <UserMessageText text={original} />
              ) : (
                <BaseButton
                  unstyled
                  type="button"
                  aria-label={
                    original === "" ? "Edit message" : `Edit message: ${userDisplayText(original)}`
                  }
                  {...stylex.props(turnStyles.userPromptHit)}
                  onClick={begin}
                  onKeyDown={(event) => {
                    if (event.key !== "F2") return;
                    event.preventDefault();
                    begin();
                  }}
                >
                  <UserMessageText text={original} />
                </BaseButton>
              )}
            </UserMessagePreview>
          </div>
        ) : (
          <div aria-busy={edit.saving || undefined} {...stylex.props(turnStyles.userEdit)}>
            {edit.error !== undefined && (
              <span role="alert" title={edit.error} {...stylex.props(turnStyles.userEditError)}>
                {edit.error}
              </span>
            )}
            <ComposerFrame
              surface="follow-up"
              document={edit.document}
              onDocumentChange={(document) =>
                patchEdit((current) => ({ ...current, document, error: undefined }))
              }
              onSubmit={save}
              placeholder="Edit message"
              autoFocus
              disabled={edit.saving}
              suggestionCatalog={composerSource(pluginCatalog.data, pluginCatalog.isError)}
              mentionFiles={composerSource(workspaceFiles.data, workspaceFiles.isError)}
              hasConversationContext
              attachments={edit.attachments}
              attachmentBusy={edit.attachmentReads !== 0}
              attachmentError={edit.attachmentError}
              onFilesSelected={(files) => void addFiles(files)}
              onAttachmentRemove={(id) =>
                patchEdit((current) => ({
                  ...current,
                  attachments: current.attachments.filter((attachment) => attachment.id !== id),
                  attachmentError: undefined,
                }))
              }
              model={modelPicker}
              editing={{ kind: "message", onCancel: () => setEdit(undefined) }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }): ReactElement {
  const [open, setOpen] = useState<boolean | undefined>();
  const expanded = open ?? streaming;
  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={setOpen}
      aria-busy={streaming || undefined}
      {...stylex.props(turnStyles.reasoning)}
    >
      <Collapsible.Trigger {...stylex.props(turnStyles.reasoningToggle, focus.ring)}>
        <span
          aria-hidden="true"
          {...stylex.props(
            turnStyles.reasoningChevron,
            expanded && turnStyles.reasoningChevronOpen,
          )}
        >
          <Icon name="chevron-right" size={11} />
        </span>
        {streaming ? "Thinking" : "Thought"}
      </Collapsible.Trigger>
      {text !== "" && (
        <Collapsible.Panel {...stylex.props(turnStyles.reasoningBody)}>
          <Prose markdown={text} streaming={streaming} />
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}

function HistoryDisclosure({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <Collapsible.Root {...stylex.props(turnStyles.history)}>
      <Collapsible.Trigger
        {...stylex.props(turnStyles.historyToggle, focus.ring)}
        render={(props, state) => (
          <button {...props}>
            {label}
            <span
              {...stylex.props(
                turnStyles.historyChevron,
                state.open && turnStyles.historyChevronOpen,
              )}
            >
              <Icon name="chevron-right" size={11} />
            </span>
          </button>
        )}
      />
      <Collapsible.Panel {...stylex.props(turnStyles.historyBody)}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

function Notice({ text }: { text: string }): ReactElement {
  const notice = presentTranscriptNotice(text);
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      title={notice.detail}
      {...stylex.props(turnStyles.notice, notice.tone === "danger" && turnStyles.noticeError)}
    >
      {notice.text}
    </div>
  );
}

/** Review is available once the latest turn that wrote files has settled. */
function TurnChangesCard({
  files,
  onReview,
  onOpenFile,
}: {
  readonly files: readonly FileChange[];
  readonly onReview: () => void;
  readonly onOpenFile: (path: string) => void;
}): ReactElement {
  const title = filesChangedLabel(files.length);
  return (
    <section aria-label={title} {...stylex.props(turnStyles.changesCard)}>
      <div {...stylex.props(turnStyles.changesHeader)}>
        <span {...stylex.props(turnStyles.changesTitle)}>{title}</span>
        <BaseButton
          unstyled
          type="button"
          title="Open the Changes panel"
          onClick={onReview}
          {...stylex.props(turnStyles.changesReview, focus.ring)}
        >
          Review
        </BaseButton>
      </div>
      <ul {...stylex.props(turnStyles.changesList)}>
        {files.map((file) => (
          <li key={file.path}>
            <BaseButton
              unstyled
              type="button"
              title={`Open ${file.path} in Changes`}
              onClick={() => onOpenFile(file.path)}
              {...stylex.props(turnStyles.changesFile, focus.ringInset)}
            >
              <span {...stylex.props(turnStyles.changesFileIcon)}>
                <FileTypeIcon path={file.path} />
              </span>
              <span {...stylex.props(turnStyles.changesPath)}>
                {file.path.split("/").at(-1) ?? file.path}
              </span>
              <span
                aria-label={`${String(file.added)} added, ${String(file.removed)} removed`}
                {...stylex.props(turnStyles.changesStats)}
              >
                {file.added > 0 && (
                  <span {...stylex.props(turnStyles.changesAdded)}>
                    +<AnimatedNumber value={file.added} />
                  </span>
                )}
                {file.removed > 0 && (
                  <span {...stylex.props(turnStyles.changesRemoved)}>
                    -<AnimatedNumber value={file.removed} />
                  </span>
                )}
              </span>
            </BaseButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TurnPartView({
  part,
  liveTools,
  cwd,
  toolCalls,
  running,
  onEditUser,
  branchModel,
}: {
  part: TurnPart;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  toolCalls: ToolCallDensity;
  running: boolean;
  onEditUser?: (
    part: UserTurnPart,
    content: UserTurnPart["content"],
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement | null {
  switch (part.kind) {
    case "user":
      return (
        <UserMessageView
          content={part.content}
          onEdit={
            onEditUser === undefined
              ? undefined
              : (content, choice) => onEditUser(part, content, choice)
          }
          branchModel={branchModel}
        />
      );
    case "assistant":
      return part.text.trim() === "" ? null : <Prose markdown={part.text} />;
    case "thinking":
      return part.text.trim() === "" ? null : <ReasoningBlock text={part.text} streaming={false} />;
    case "tool":
      return (
        <ToolCallView
          part={part}
          progress={liveTools.get(part.callId)?.progress}
          cwd={cwd}
          active={running}
          density={toolCalls}
        />
      );
    case "note":
      return <Notice text={part.text} />;
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

export const TurnView = memo(function TurnView({
  turn,
  liveTools,
  live,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
  running = false,
}: {
  turn: RenderedTurn;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  live?: LiveSnapshot;
  cwd: string | undefined;
  onEditUser?: (
    part: UserTurnPart,
    content: UserTurnPart["content"],
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
  /** Absent in read-only views, which then omit the changes card. */
  onOpenChanges?: (target: TurnChangesTarget) => void;
  running?: boolean;
}): ReactElement | null {
  const appearance = useAppearanceSettings();
  const changes = useMemo(() => changesFromTurns([turn]), [turn]);
  // Progress updates must reuse the settled grouping so summaries can update only live tools.
  const display = useMemo(
    () => (turn.kind === "turn" ? displayTranscriptParts(turn.parts) : []),
    [turn],
  );
  switch (turn.kind) {
    case "turn": {
      // A completion's continuation turn draws nothing until its response
      // lands; an empty completed turn must not leave a blank row behind.
      if (turn.parts.length === 0 && turn.outcome === "completed") return null;
      const hasFailureNote = turn.parts.some(
        (part) => part.kind === "note" && isFailureNotice(part.text),
      );
      return (
        <div
          data-sticky-turn={turn.parts.some((part) => part.kind === "user") || undefined}
          {...stylex.props(turnStyles.turn)}
        >
          {display.map((item, index) => {
            if (item.kind === "work") {
              const first = item.parts[0];
              // Only the trailing group carries the run; an earlier one is
              // settled history, and the run's indicator belongs below the
              // prose that follows it.
              const trailing = index === display.length - 1;
              return (
                <WorkGroupView
                  key={`work:${first === undefined ? turn.id : turnPartId(first)}`}
                  parts={item.parts}
                  live={trailing ? live : undefined}
                  liveTools={liveTools}
                  cwd={cwd}
                  durationMs={turn.durationMs}
                  running={running && trailing}
                  density={appearance.toolCalls}
                />
              );
            }
            if (item.kind === "response") {
              const first = item.parts[0];
              const markdown = item.parts.map((part) => part.text.trim()).join("\n\n");
              return markdown === "" ? null : (
                <Prose
                  key={`response:${first === undefined ? turn.id : turnPartId(first)}`}
                  markdown={markdown}
                />
              );
            }
            return (
              <TurnPartView
                key={turnPartId(item.part)}
                part={item.part}
                liveTools={liveTools}
                cwd={cwd}
                toolCalls={appearance.toolCalls}
                running={running}
                onEditUser={onEditUser}
                branchModel={branchModel}
              />
            );
          })}
          {turn.outcome === "aborted" && !hasFailureNote && <Notice text="Run stopped." />}
          {turn.outcome === "failed" && !hasFailureNote && <Notice text="Error: Run failed." />}
          {!running && changes.length > 0 && onOpenChanges !== undefined && (
            <TurnChangesCard
              files={changes}
              onReview={() => onOpenChanges({ kind: "turn", turnId: turn.id })}
              onOpenFile={(path) => onOpenChanges({ kind: "file", turnId: turn.id, path })}
            />
          )}
        </div>
      );
    }
    case "checkpoint":
      return (
        <HistoryDisclosure label="Chat context summarized">
          <Prose markdown={turn.body.summary} />
        </HistoryDisclosure>
      );
    case "summary":
      return (
        <HistoryDisclosure label="Branch summary">
          <Prose markdown={turn.body.text} />
        </HistoryDisclosure>
      );
    case "note":
      return <Notice text={presentNote(turn).text} />;
    default: {
      const _exhaustive: never = turn;
      return _exhaustive;
    }
  }
});
