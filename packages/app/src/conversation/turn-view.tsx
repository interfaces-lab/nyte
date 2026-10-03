import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
/**
 * One transcript item. User prompts are the only ordinary contained message
 * region. Assistant prose stays flat, while reasoning, tools, and system
 * history use compact rows. Parts keep core's stable identity so settled and
 * streaming content exchange in place.
 */
import { props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { BubbleContent } from "@nyte-ai/ui/bubble";
import { Message } from "@nyte-ai/ui/message";
import { AttachmentGroup } from "@nyte-ai/ui/attachment";
// oxlint-disable-next-line no-restricted-imports -- the outside-click listener lives only while an edit can dismiss
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { changesFromTurns, turnPartId } from "@nyte-ai/client";
import type { FileChange, Turn, TurnPart, UserTurnPart } from "@nyte-ai/protocol";
import type { ModelThinkingLevel } from "@nyte-ai/schema";
import type { RenderedTurn } from "./transcript-rows.ts";
import { CHANGES_VISIBLE_FILES, filesChangedLabel } from "../workbench/change-tree.ts";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { useMentionFiles, usePluginCatalog } from "../queries.ts";
import { Prose } from "./prose.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerFrame } from "./composer.tsx";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import { composerMessageContent } from "./composer-send.ts";
import { composerSource } from "./composer-suggestions.tsx";
import { ImagePreview } from "./image-preview.tsx";
import { UserMessageText, messageImages, userMessageText } from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import { ModelPicker } from "./model-picker.tsx";
import type { ModelPickerChange } from "./model-picker.tsx";
import {
  USER_MESSAGE_PREVIEW_LINES,
  bubbleStyles,
  messageStyles,
  turnStyles,
} from "./styles.stylex.ts";
import { StatusMarker } from "./row-surfaces.tsx";
import { ToolCallView } from "./tool-call.tsx";
import { WorkGroupView } from "./tool-group.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { failureNotice } from "./tool-copy.ts";
import { displayTranscriptParts, userDisplayText } from "./transcript-presentation.ts";
import { errorMessage } from "../errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../nyte.ts";

function UserMessagePreview({
  expandable,
  children,
}: {
  expandable: boolean;
  children: ReactNode;
}): ReactElement {
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
        {...props(
          turnStyles.userPreview,
          !expanded && turnStyles.userPreviewCollapsed,
          !expanded && overflowing && turnStyles.userPreviewFade,
        )}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {expandable && overflowing && (
        <Button
          variant="text"
          tone="neutral"
          size="xs"
          data-slot={expanded ? undefined : "row-primary"}
          aria-controls={id}
          aria-expanded={expanded}
          xstyle={turnStyles.userPreviewToggle}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show Less" : "Show More"}
        </Button>
      )}
    </>
  );
}

function UserMessageImages({ content }: { content: UserTurnPart["content"] }): ReactElement | null {
  const images = messageImages(content);

  if (images.length === 0) return null;

  return (
    <AttachmentGroup {...props(turnStyles.userImages)}>
      {images.map((item, index) => (
        <ImagePreview
          key={index}
          src={`data:${item.mimeType};base64,${item.data}`}
          name={`Image ${String(index + 1)}`}
        />
      ))}
    </AttachmentGroup>
  );
}

export interface BranchModelChoice {
  readonly model: DesktopModelOption | undefined;
  readonly thinkingLevel: ModelThinkingLevel | undefined;
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
  const editorRef = useRef<ComposerEditorHandle | null>(null);
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

    return attachComposerFiles({ files, editor: editorRef.current })
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
    const next = composerMessageContent(submission.text.trim(), edit.attachments);

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
    <div ref={rowRef} data-sticky-user-message {...props(turnStyles.userRow)}>
      <Message align="end" {...props(messageStyles.end)}>
        {edit === undefined ? (
          <BubbleContent render={<Row xstyle={bubbleStyles.default} />}>
            <UserMessageImages content={content} />
            {original !== "" && (
              <UserMessagePreview expandable={onEdit === undefined}>
                <UserMessageText text={original} />
              </UserMessagePreview>
            )}
            {onEdit !== undefined && (
              <Row.Primary
                aria-keyshortcuts="F2"
                aria-description={original === "" ? undefined : userDisplayText(original)}
                xstyle={srOnly}
                onClick={begin}
                onKeyDown={(event) => {
                  if (event.key !== "F2") return;
                  event.preventDefault();
                  begin();
                }}
              >
                Edit Message
              </Row.Primary>
            )}
          </BubbleContent>
        ) : (
          <div aria-busy={edit.saving || undefined} {...props(turnStyles.userEdit)}>
            {edit.error !== undefined && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span role="alert" {...props(intent.danger, turnStyles.userEditError)}>
                      {edit.error}
                    </span>
                  }
                />
                <TooltipContent>{edit.error}</TooltipContent>
              </Tooltip>
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
              inputRef={(handle) => {
                editorRef.current = handle;
              }}
              editing={{ kind: "message", onCancel: () => setEdit(undefined) }}
            />
          </div>
        )}
      </Message>
    </div>
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
    <Collapsible.Root xstyle={turnStyles.history}>
      <Collapsible.Trigger xstyle={turnStyles.disclosureToggle}>
        {label}
        <Collapsible.Chevron />
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={turnStyles.historyBody}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

function TurnChangesCard({
  files,
  onReview,
  onOpenFile,
}: {
  readonly files: readonly FileChange[];
  readonly onReview: () => void;
  readonly onOpenFile: (path: string) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const title = filesChangedLabel(files.length);
  const collapsed = !expanded && files.length > CHANGES_VISIBLE_FILES;
  const shown = collapsed ? files.slice(0, CHANGES_VISIBLE_FILES - 1) : files;

  return (
    <section aria-label={title} {...props(turnStyles.changesCard)}>
      <div {...props(turnStyles.changesHeader)}>
        <span {...props(turnStyles.changesTitle)}>{title}</span>
        <Button variant="plain" size="sm" onClick={onReview} xstyle={turnStyles.changesReview}>
          Review
        </Button>
      </div>
      <ul {...props(turnStyles.changesList)}>
        {shown.map((file) => (
          <Row key={file.path} render={<li />} interactive xstyle={turnStyles.changesFile}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Row.Primary
                    aria-label={`Open ${file.path} in Changes`}
                    onClick={() => onOpenFile(file.path)}
                  >
                    <Row.Leading xstyle={turnStyles.changesFileIcon}>
                      <FileTypeIcon path={file.path} />
                    </Row.Leading>
                    <Row.Label>{file.path.split("/").at(-1) ?? file.path}</Row.Label>
                    <span
                      aria-label={`${String(file.added)} added, ${String(file.removed)} removed`}
                      {...props(turnStyles.changesStats)}
                    >
                      {file.added > 0 && (
                        <span {...props(intent.success, turnStyles.changesAdded)}>
                          +{file.added}
                        </span>
                      )}
                      {file.removed > 0 && (
                        <span {...props(intent.danger, turnStyles.changesRemoved)}>
                          &minus;{file.removed}
                        </span>
                      )}
                    </span>
                  </Row.Primary>
                }
              />
              <TooltipContent side="top">{file.path}</TooltipContent>
            </Tooltip>
          </Row>
        ))}
        {collapsed && (
          <Row render={<li />} interactive xstyle={turnStyles.changesFile}>
            <Row.Primary aria-expanded={false} onClick={() => setExpanded(true)}>
              <Row.Leading xstyle={turnStyles.changesFileIcon}>
                <Icon name="more-horizontal" size={14} />
              </Row.Leading>
              <Row.Label>{`Show ${String(files.length - shown.length)} more`}</Row.Label>
            </Row.Primary>
          </Row>
        )}
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
          content={part.source?.label ?? part.content}
          onEdit={
            onEditUser === undefined || part.source?.kind === "action"
              ? undefined
              : (content, choice) => onEditUser(part, content, choice)
          }
          branchModel={branchModel}
        />
      );
    case "assistant":
      return part.text.trim() === "" ? null : <Prose markdown={part.text} />;
    case "thinking":
      return <ThinkingLine text={part.text} streaming={false} />;
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
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

const ResponseView = memo(function ResponseView({
  parts,
}: {
  parts: readonly Extract<TurnPart, { readonly kind: "assistant" }>[];
}): ReactElement | null {
  const markdown = useMemo(() => parts.map((part) => part.text.trim()).join("\n\n"), [parts]);

  return markdown === "" ? null : <Prose markdown={markdown} />;
});

export const TurnView = memo(function TurnView({
  turn,
  liveTools,
  live,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
  running,
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
  onOpenChanges: (target: TurnChangesTarget) => void;
  running: boolean;
}): ReactElement | null {
  const appearance = useAppearanceSettings();
  const changes = useMemo(() => changesFromTurns([turn]), [turn]);

  const changeTotals = useMemo(
    () =>
      changes.reduce(
        (totals, file) => ({
          added: totals.added + file.added,
          removed: totals.removed + file.removed,
        }),
        { added: 0, removed: 0 },
      ),
    [changes],
  );

  // Progress updates must reuse the settled grouping so summaries can update only live tools.
  const display = useMemo(
    () => (turn.kind === "turn" ? displayTranscriptParts(turn.parts) : []),
    [turn],
  );

  switch (turn.kind) {
    case "turn": {
      // A completion's continuation turn draws nothing until its response
      // lands; an empty completed turn must not leave a blank row behind.
      if (turn.parts.length === 0 && turn.failure === undefined) return null;
      const failure = turn.failure === undefined ? undefined : failureNotice(turn.failure);

      return (
        <div {...props(turnStyles.turn)}>
          {display.map((item, index) => {
            if (item.kind === "work") {
              const first = item.parts[0];
              // Only the trailing group carries the run; an earlier one is
              // settled history, and the run's indicator belongs below the
              // prose that follows it.
              const trailing = index === display.length - 1;
              const active = running && trailing;

              // One settled call has nothing to fold; its own line says more
              // than a header counting it.
              if (!active && item.parts.length === 1 && first?.kind === "tool") {
                return (
                  <TurnPartView
                    key={turnPartId(first)}
                    part={first}
                    liveTools={liveTools}
                    cwd={cwd}
                    toolCalls={appearance.toolCalls}
                    running={false}
                  />
                );
              }

              return (
                <WorkGroupView
                  key={`work:${first === undefined ? turn.id : turnPartId(first)}`}
                  parts={item.parts}
                  run={turn.run}
                  live={trailing ? live : undefined}
                  liveTools={liveTools}
                  cwd={cwd}
                  added={trailing ? changeTotals.added : 0}
                  removed={trailing ? changeTotals.removed : 0}
                  running={active}
                  density={appearance.toolCalls}
                />
              );
            }

            if (item.kind === "response") {
              const first = item.parts[0];

              return (
                <ResponseView
                  key={`response:${first === undefined ? turn.id : turnPartId(first)}`}
                  parts={item.parts}
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
          {failure !== undefined && (
            <StatusMarker
              role={failure.tone === "danger" ? "alert" : "status"}
              variant={failure.tone === "danger" ? "destructive" : "default"}
            >
              {failure.text}
            </StatusMarker>
          )}
          {!running && changes.length > 0 && (
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
    default: {
      const _exhaustive: never = turn;

      return _exhaustive;
    }
  }
});
