import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
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
import { flushSync } from "react-dom";
import type { Message as ViewMessage, SessionView, UserContent } from "@nyte-ai/sdk";
import { drawPart } from "../client-plugins.tsx";
import { useTranscriptControls, useTranscriptScope } from "./transcript.tsx";
import type { ModelThinkingLevel } from "@nyte-ai/schema/model";
import { isPart, branchSummary, compaction } from "@nyte-ai/plugin/client";
import type { ConversationTurn, UserMessage } from "../view-helpers.ts";
import { isToolMessage } from "../view-helpers.ts";
import { CHANGES_VISIBLE_FILES, filesChangedLabel } from "../workbench/change-tree.ts";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../preferences/index.ts";
import { useMentionFiles, usePluginCatalog } from "../queries.ts";
import { Prose } from "./prose.tsx";
import { SubagentGroupView, SubagentReportLine } from "./subagent-call.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import { ComposerFrame } from "./composer-frame.tsx";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import {
  composerContentEmpty,
  composerMessageContent,
  uploadComposerContent,
} from "./composer-send.ts";
import { composerSource } from "./composer-suggestions.tsx";
import { ImagePreview } from "./image-preview.tsx";
import {
  UserMessageText,
  messageFiles,
  messageImages,
  userMessageText,
} from "./message-content.tsx";
import type { MessageFile } from "./message-content.tsx";
import { messageDraftText } from "./message-references.ts";
import { useBlobUrl } from "../use-blob-url.ts";
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
import { StepGroupView } from "./step-group.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { failureNotice } from "./tool-copy.ts";
import {
  displayTranscriptParts,
  isTextMessage,
  isThinkingMessage,
  userDisplayText,
} from "./transcript-presentation.ts";
import type { TextMessage } from "./transcript-presentation.ts";
import { errorMessage } from "../errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../catalog.ts";

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

function BlobImage({ file }: { file: MessageFile }): ReactElement | null {
  const src = useBlobUrl(file.blob);

  return src === undefined ? null : <ImagePreview src={src} name={file.name} />;
}

function UserMessageImages({ content }: { content: UserContent }): ReactElement | null {
  const images = messageImages(content);

  if (images.length === 0) return null;

  return (
    <AttachmentGroup {...props(turnStyles.userImages)}>
      {images.map((item) => (
        <BlobImage key={item.blob} file={item} />
      ))}
    </AttachmentGroup>
  );
}

export interface BranchModelChoice {
  readonly model: DesktopModelOption | undefined;
  readonly thinkingLevel: ModelThinkingLevel | undefined;
  /** The choice is the model's fast sibling. */
  readonly fast: boolean;
}

export interface BranchModelPicker extends BranchModelChoice {
  readonly catalog: DesktopCatalog | undefined;
}

type ConversationTurnId = ConversationTurn["info"]["id"];

export type TurnChangesTarget =
  | { readonly kind: "turn"; readonly turnId: ConversationTurnId }
  | { readonly kind: "file"; readonly turnId: ConversationTurnId; readonly path: string };

interface UserEditState extends BranchModelChoice {
  /** The message as a draft: its head sentences back as chips, edited in the composer's editor. */
  readonly document: ComposerDocumentState;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly kept: readonly MessageFile[];
  readonly attachmentReads: number;
  readonly attachmentError: string | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
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
  content: UserContent;
  onEdit?: (content: UserContent, choice: BranchModelChoice) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement {
  const [edit, setEdit] = useState<UserEditState | undefined>();
  const rowRef = useRef<HTMLDivElement>(null);
  const transcript = useTranscriptControls();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const canDismissEdit = edit !== undefined && !edit.saving && edit.attachmentReads === 0;
  useEffect(() => {
    const row = rowRef.current;

    if (!canDismissEdit || row === null) return;

    const dismiss = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.composedPath().includes(row))
        return;
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest(
          '[data-composer-frame], [role="menu"], [role="listbox"], [role="dialog"], [data-base-ui-inert]',
        )
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

    if (rowRef.current !== null) transcript.hold(rowRef.current);
    flushSync(() =>
      setEdit({
        document: { text, selectionStart: text.length, selectionEnd: text.length },
        attachments: [],
        kept: messageFiles(content),
        attachmentReads: 0,
        attachmentError: undefined,
        saving: false,
        error: undefined,
        model: branchModel?.model,
        thinkingLevel: branchModel?.thinkingLevel,
        fast: branchModel?.fast === true,
      }),
    );
    editorRef.current?.focus({ preventScroll: true });
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
    const draft = composerMessageContent(submission.text.trim(), edit.attachments, edit.kept);

    if (composerContentEmpty(draft)) {
      setEdit({ ...edit, error: "A message cannot be empty." });

      return false;
    }

    setEdit({ ...edit, saving: true, error: undefined });

    try {
      const next = await uploadComposerContent(draft);
      await onEdit(next, {
        model: edit.model,
        thinkingLevel: edit.thinkingLevel,
        fast: edit.fast,
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
        fast={edit.fast}
        disabled={edit.saving}
        onChange={(change: ModelPickerChange) => {
          switch (change.kind) {
            case "model":
              setEdit({
                ...edit,
                model: change.option,
                thinkingLevel: change.thinkingLevel,
                fast: false,
              });

              return;
            case "thinking":
              setEdit({ ...edit, thinkingLevel: change.thinkingLevel });

              return;
            case "fast":
              setEdit({ ...edit, fast: change.enabled });

              return;

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
          <BubbleContent render={<Row variant="bare" xstyle={bubbleStyles.default} />}>
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
  readonly files: SessionView["changes"];
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

function NoteView({ message }: { message: ViewMessage }): ReactElement | null {
  const sessionId = useTranscriptScope()?.sessionId;

  if (isPart(message, compaction)) {
    return message.state.summary === null ? null : (
      <HistoryDisclosure label="Chat context summarized">
        <Prose markdown={message.state.summary} />
      </HistoryDisclosure>
    );
  }

  if (isPart(message, branchSummary)) {
    return (
      <HistoryDisclosure label="Branch summary">
        <Prose markdown={message.state.markdown} />
      </HistoryDisclosure>
    );
  }

  if (message.kind !== "part" || sessionId === undefined) return null;

  return <>{drawPart(sessionId, message, { kind: "transcript", role: message.role })}</>;
}

function TurnPartView({
  message,
  cwd,
  density,
  onEditUser,
  branchModel,
}: {
  message: ViewMessage;
  cwd: string | undefined;
  density: ToolCallDensity;
  onEditUser?: (
    message: UserMessage,
    content: UserContent,
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement | null {
  if (message.kind === "user") {
    const { source } = message;

    if (source.kind === "child" || source.kind === "job")
      return <SubagentReportLine source={source} content={message.content} held={false} />;

    return (
      <UserMessageView
        content={message.source.kind === "action" ? message.source.label : message.content}
        onEdit={
          onEditUser === undefined || message.source.kind === "action"
            ? undefined
            : (content, choice) => onEditUser(message, content, choice)
        }
        branchModel={branchModel}
      />
    );
  }

  if (isTextMessage(message))
    return message.state.markdown.trim() === "" ? null : (
      <Prose markdown={message.state.markdown} />
    );

  if (isThinkingMessage(message))
    return (
      <ThinkingLine text={message.state.markdown} streaming={message.status.kind === "live"} />
    );

  if (isToolMessage(message)) return <ToolCallView message={message} cwd={cwd} density={density} />;

  return <NoteView message={message} />;
}

const ResponseView = memo(function ResponseView({
  messages,
}: {
  messages: readonly TextMessage[];
}): ReactElement | null {
  const markdown = useMemo(
    () => messages.map((message) => message.state.markdown.trim()).join("\n\n"),
    [messages],
  );
  const streaming = messages.some((message) => message.status.kind === "live");

  return markdown === "" ? null : <Prose markdown={markdown} streaming={streaming} />;
});

interface TurnBodyProps {
  density: ToolCallDensity;
  cwd: string | undefined;
  changes: SessionView["changes"];
  onEditUser?: (
    message: UserMessage,
    content: UserContent,
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
  onOpenChanges: (target: TurnChangesTarget) => void;
  running: boolean;
}

function drawsNothing(turn: ConversationTurn): boolean {
  return turn.messages.length === 0 && turn.info.state.kind !== "ended";
}

function turnChanges(
  turn: ConversationTurn,
  changes: SessionView["changes"],
): SessionView["changes"] {
  const paths = new Set(
    turn.messages.flatMap((message) =>
      isToolMessage(message) && message.state.phase === "settled"
        ? (message.state.changes?.paths ?? [])
        : [],
    ),
  );

  return changes.filter((change) => paths.has(change.path));
}

const TurnBody = memo(function TurnBody({
  turn,
  density,
  cwd,
  changes: sessionChanges,
  onEditUser,
  branchModel,
  onOpenChanges,
  running,
}: TurnBodyProps & { turn: ConversationTurn }): ReactElement | null {
  const changes = useMemo(() => turnChanges(turn, sessionChanges), [turn, sessionChanges]);
  const display = useMemo(() => displayTranscriptParts(turn.messages), [turn]);

  if (drawsNothing(turn)) return null;
  const { state } = turn.info;
  const failure =
    state.kind === "ended" && state.end.kind === "failed"
      ? failureNotice(state.end.failure)
      : undefined;

  return (
    <>
      {display.map((item, index) => {
        if (item.kind === "step") {
          const [first] = item.messages;
          const trailing = index === display.length - 1;
          const active = running && trailing;

          if (
            !active &&
            item.messages.length === 1 &&
            first !== undefined &&
            isToolMessage(first)
          ) {
            return <TurnPartView key={first.id} message={first} cwd={cwd} density={density} />;
          }

          return (
            <StepGroupView
              key={`step:${first?.id ?? turn.info.id}`}
              messages={item.messages}
              cwd={cwd}
              added={trailing ? turn.info.summary.added : 0}
              removed={trailing ? turn.info.summary.removed : 0}
              running={active}
              density={density}
            />
          );
        }

        if (item.kind === "agents") {
          return (
            <SubagentGroupView
              key={`agents:${item.messages[0]?.id ?? turn.info.id}`}
              messages={item.messages}
              cwd={cwd}
            />
          );
        }

        if (item.kind === "response") {
          return (
            <ResponseView
              key={`response:${item.messages[0]?.id ?? turn.info.id}`}
              messages={item.messages}
            />
          );
        }

        return (
          <TurnPartView
            key={item.message.id}
            message={item.message}
            cwd={cwd}
            density={density}
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
          onReview={() => onOpenChanges({ kind: "turn", turnId: turn.info.id })}
          onOpenFile={(path) => onOpenChanges({ kind: "file", turnId: turn.info.id, path })}
        />
      )}
    </>
  );
});

export const TurnView = memo(function TurnView({
  turn,
  continuations,
  running,
  ...body
}: TurnBodyProps & {
  turn: ConversationTurn;
  continuations: readonly ConversationTurn[];
}): ReactElement | null {
  const turns = [turn, ...continuations];

  if (turns.every(drawsNothing)) return null;

  return (
    <div {...props(turnStyles.turn)}>
      {turns.map((entry, index) => (
        <TurnBody
          key={entry.info.id}
          {...body}
          turn={entry}
          running={running && index === turns.length - 1}
        />
      ))}
    </div>
  );
});
