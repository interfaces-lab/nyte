import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { create, props } from "@stylexjs/stylex";
import { media, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { BubbleContent } from "@nyte-ai/ui/bubble";
import { Message } from "@nyte-ai/ui/message";
import { AttachmentGroup } from "@nyte-ai/ui/attachment";
import { useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { flushSync } from "react-dom";
import type { CommitId, Message as ViewMessage, SessionView, UserContent } from "@nyte-ai/sdk";
import {
  failureNotice,
  showsAnswer,
  showsThinking,
  showsTool,
} from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { drawPart } from "../../canvas/client-plugins.tsx";
import { useTranscriptControls, useTranscriptScope } from "./transcript.tsx";
import type { ModelThinkingLevel } from "@nyte-ai/schema/model";
import { isPart, branchSummary, compaction } from "@nyte-ai/plugin/client";
import { CHANGES_VISIBLE_FILES, filesChangedLabel } from "../../diff/change-tree.ts";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { useMentionFiles } from "../../data/files.ts";
import { usePluginCatalog } from "../../data/plugins.ts";
import { Prose } from "../markdown/prose.tsx";
import { useReferenceOpener } from "../../references/reference-opener.tsx";
import { SubagentGroupView, SubagentReportLine } from "../tools/subagent-call.tsx";
import { AnswerLine } from "./answer-line.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "../composer/composer-document.ts";
import { ComposerFrame } from "../composer/composer-frame.tsx";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { attachComposerFiles } from "../composer/composer-files.ts";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";
import { useChatFolder } from "../chat-folder.ts";
import {
  composerContentEmpty,
  composerMessageContent,
  uploadComposerContent,
} from "../composer/composer-send.ts";
import { composerSource } from "../composer/composer-suggestions.tsx";
import { ImagePreview } from "../markdown/image-preview.tsx";
import { UserMessageText, messageFiles, messageImages } from "./message-content.tsx";
import type { MessageFile } from "./message-content.tsx";
import { contentDraftText } from "../../references/message-references.ts";
import { useBlobUrl } from "../../lib/use-blob-url.ts";
import { connection } from "../../data/connection.ts";
import { forkChat } from "../../data/session-actions.ts";
import { ModelPicker } from "../composer/model-picker.tsx";
import type { ModelPickerChange } from "../composer/model-picker.tsx";
import {
  USER_MESSAGE_PREVIEW_LINES,
  bubbleStyles,
  messageStyles,
  turnStyles,
} from "./turn.stylex.ts";
import { StatusMarker } from "./row-surfaces.tsx";
import { RecoveryAction } from "./turn-recovery.tsx";
import { ToolCallView } from "../tools/tool-call.tsx";
import { StepGroupView } from "./step-group.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { replyAge, userDisplayText, workedFor } from "./transcript-presentation.ts";
import { useCopyConfirmation } from "../../components/copy-confirmation.ts";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { conversation } from "../../theme/schema.stylex.ts";
import { useNowMinute } from "../../lib/use-now-minute.ts";
import type { PromptRow, TurnItemRow } from "./transcript-rows.ts";
import { errorMessage } from "../../contract/errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../../data/catalog.ts";
import { ChangeStats } from "../../components/change-stats.tsx";

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

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the message before paint for the expand control
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
  const src = useBlobUrl(["blob", file.blob], () => connection().blob(file.blob)).data;

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
  readonly fast: boolean;
}

export interface BranchModelPicker extends BranchModelChoice {
  readonly catalog: DesktopCatalog | undefined;
}

interface UserEditState extends BranchModelChoice {
  readonly document: ComposerDocumentState;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly kept: readonly MessageFile[];
  readonly attachmentReads: number;
  readonly attachmentError: string | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
}

export function UserMessageView({
  content,
  pending = false,
  onEdit,
  branchModel,
}: {
  content: UserContent;
  pending?: boolean;
  onEdit?: (content: UserContent, choice: BranchModelChoice) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement {
  const [edit, setEdit] = useState<UserEditState | undefined>();
  const rowRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const transcript = useTranscriptControls();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const editGeneration = useRef(0);
  const original = contentDraftText(content);

  const canDismissEdit =
    edit !== undefined &&
    !edit.saving &&
    edit.attachmentReads === 0 &&
    edit.document.text === original &&
    edit.attachments.length === 0 &&
    edit.kept.length === messageFiles(content).length;

  const keepWhileEditing = (element: HTMLDivElement | null): (() => void) | undefined =>
    element === null ? undefined : transcript.keep(element);

  const pluginCatalog = usePluginCatalog(useTranscriptScope()?.sessionId);
  const workspaceFiles = useMentionFiles(useChatFolder(), edit !== undefined);

  const begin = (): void => {
    if (rowRef.current !== null) transcript.hold(rowRef.current);
    editGeneration.current += 1;
    flushSync(() =>
      setEdit({
        document: {
          text: original,
          selectionStart: original.length,
          selectionEnd: original.length,
        },
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

  const cancel = (): void => {
    flushSync(() => setEdit(undefined));
    editButtonRef.current?.focus({ preventScroll: true });
  };

  const reveal = (): void => {
    const row = rowRef.current;
    const messages = row?.closest<HTMLElement>('[role="region"]');

    if (row === null || messages === null || messages === undefined) return;
    const box = row.getBoundingClientRect();
    const view = messages.getBoundingClientRect();

    if (box.bottom <= view.top || box.top >= view.bottom) row.scrollIntoView({ block: "nearest" });
  };

  const patchEdit = (patch: (current: UserEditState) => UserEditState): void => {
    setEdit((current) => (current === undefined ? current : patch(current)));
  };

  const addFiles = async (
    files: readonly File[],
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    const generation = editGeneration.current;

    const patchSameEdit = (patch: (current: UserEditState) => UserEditState): void => {
      if (generation === editGeneration.current) patchEdit(patch);
    };

    patchSameEdit((current) => ({ ...current, attachmentReads: current.attachmentReads + 1 }));

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        signal?.throwIfAborted();
        patchSameEdit((current) => ({
          ...current,
          attachments: [...current.attachments, ...result.attachments],
          attachmentError: result.error,
        }));

        return result.error;
      })
      .finally(() =>
        patchSameEdit((current) => ({ ...current, attachmentReads: current.attachmentReads - 1 })),
      );
  };

  const save = async (submission: ComposerSubmission): Promise<void> => {
    if (edit === undefined || edit.saving || onEdit === undefined) return;
    const draft = composerMessageContent(submission.parts, edit.attachments, edit.kept);

    if (composerContentEmpty(draft)) {
      setEdit({ ...edit, error: "A message cannot be empty." });

      return;
    }

    setEdit({ ...edit, saving: true, error: undefined });
    const messages = rowRef.current?.closest<HTMLElement>('[role="region"]');
    const choice = { model: edit.model, thinkingLevel: edit.thinkingLevel, fast: edit.fast };

    const failure = await uploadComposerContent(draft)
      .then((next) => onEdit(next, choice))
      .then(
        () => undefined,
        (cause: unknown) => errorMessage(cause),
      );

    if (failure !== undefined) {
      patchEdit((current) => ({ ...current, saving: false, error: failure }));

      return;
    }

    setEdit(undefined);
    messages?.focus({ preventScroll: true });
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
    <div
      ref={rowRef}
      data-sticky-user-message
      title={pending ? "Lands at the next response" : undefined}
      {...props(turnStyles.userRow, pending && turnStyles.userPending)}
    >
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
                ref={editButtonRef}
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
          <div
            ref={keepWhileEditing}
            aria-busy={edit.saving || undefined}
            {...props(turnStyles.userEdit)}
          >
            {canDismissEdit && (
              <DismissOnOutsideClick rowRef={rowRef} onDismiss={() => setEdit(undefined)} />
            )}
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
              onDocumentChange={(document) => {
                if (document.text !== edit.document.text) reveal();
                patchEdit((current) => ({ ...current, document, error: undefined }));
              }}
              onSubmit={save}
              placeholder="Edit message"
              disabled={edit.saving}
              suggestionCatalog={composerSource(pluginCatalog.data, pluginCatalog.isError)}
              mentionFiles={composerSource(workspaceFiles.data, workspaceFiles.isError)}
              hasConversationContext
              attachments={edit.attachments}
              attachmentBusy={edit.attachmentReads !== 0}
              attachmentError={edit.attachmentError}
              onFilesSelected={addFiles}
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
              editing={{ kind: "message", onCancel: cancel }}
            />
          </div>
        )}
      </Message>
    </div>
  );
}

function DismissOnOutsideClick({
  rowRef,
  onDismiss,
}: {
  readonly rowRef: RefObject<HTMLDivElement | null>;
  readonly onDismiss: () => void;
}): null {
  const dismiss = useEffectEvent(onDismiss);

  useMountEffect(() => {
    const row = rowRef.current;

    if (row === null) return;

    const listener = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.composedPath().includes(row))
        return;
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('[role="menu"], [role="listbox"], [role="dialog"], [data-base-ui-inert]')
      )
        return;
      dismiss();
    };

    row.ownerDocument.addEventListener("click", listener);

    return () => row.ownerDocument.removeEventListener("click", listener);
  });

  return null;
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

export function ChangesCard({
  files,
  onOpenChanges,
}: {
  readonly files: SessionView["changes"];
  readonly onOpenChanges: (path: string | null) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const title = filesChangedLabel(files.length);
  const collapsed = !expanded && files.length > CHANGES_VISIBLE_FILES;
  const shown = collapsed ? files.slice(0, CHANGES_VISIBLE_FILES - 1) : files;

  return (
    <section aria-label={title} {...props(turnStyles.changesCard)}>
      <div {...props(turnStyles.changesHeader)}>
        <span {...props(turnStyles.changesTitle)}>{title}</span>
        <Button
          variant="plain"
          size="sm"
          onClick={() => onOpenChanges(null)}
          xstyle={turnStyles.changesReview}
        >
          Review
        </Button>
      </div>
      <ul {...props(turnStyles.changesList)}>
        {shown.map((file) => (
          <Row
            key={file.path}
            render={<li />}
            interactive
            data-change-stats-control=""
            xstyle={turnStyles.changesFile}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Row.Primary
                    aria-label={`Open ${file.path} in Changes`}
                    onClick={() => onOpenChanges(file.path)}
                  >
                    <Row.Leading xstyle={turnStyles.changesFileIcon}>
                      <FileTypeIcon path={file.path} />
                    </Row.Leading>
                    <Row.Label>{file.path.split("/").at(-1) ?? file.path}</Row.Label>
                    <ChangeStats added={file.added} removed={file.removed} />
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
                <Icon name="more-horizontal" size="sm" />
              </Row.Leading>
              <Row.Label>{`Show ${String(files.length - shown.length)} more`}</Row.Label>
            </Row.Primary>
          </Row>
        )}
      </ul>
    </section>
  );
}

export function ChangesFooter({
  state,
  files,
}: {
  readonly state: "pending" | "ready";
  readonly files: SessionView["changes"];
}): ReactElement {
  const opener = useReferenceOpener();

  return (
    <div {...props(turnStyles.changesFooter(CHANGES_VISIBLE_FILES))}>
      {state === "ready" && files.length > 0 && (
        <ChangesCard
          files={files}
          onOpenChanges={(path) => opener?.({ kind: "changes", path })?.()}
        />
      )}
    </div>
  );
}

function NoteView({ message }: { message: ViewMessage }): ReactElement | null {
  const sessionId = useTranscriptScope()?.sessionId;

  if (isPart(message, compaction)) {
    if (message.status.kind === "live")
      return (
        <StatusMarker role="status" variant="retrying">
          Summarizing chat context…
        </StatusMarker>
      );

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
  pending,
  cwd,
  density,
  onEditUser,
  branchModel,
}: {
  message: ViewMessage;
  pending?: boolean;
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

    if (showsAnswer(message)) return <AnswerLine message={message} held={false} />;

    return (
      <UserMessageView
        content={message.source.kind === "action" ? message.source.label : message.content}
        pending={pending}
        onEdit={
          onEditUser === undefined || message.source.kind === "action"
            ? undefined
            : (content, choice) => onEditUser(message, content, choice)
        }
        branchModel={branchModel}
      />
    );
  }

  if (showsThinking(message))
    return (
      <ThinkingLine text={message.state.markdown} streaming={message.status.kind === "live"} />
    );

  if (showsTool(message)) return <ToolCallView message={message} cwd={cwd} density={density} />;

  return <NoteView message={message} />;
}

const replyStyles = create({
  reply: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    minWidth: 0,
    "--_reply-time-opacity": {
      default: 0,
      ":hover": { [media.hover]: 1 },
      ":focus-within": 1,
    },
  },
  latest: { "--_reply-time-opacity": 1 },
  actions: { display: "flex", alignItems: "center", gap: space.s1 },
  time: {
    color: role.contentTertiary,
    opacity: "var(--_reply-time-opacity)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

function ResponseView({
  row,
}: {
  row: Extract<TurnItemRow, { kind: "response" }>;
}): ReactElement | null {
  const markdown = row.messages.map((message) => message.state.markdown.trim()).join("\n\n");
  const streaming = row.messages.some((message) => message.status.kind === "live");
  const first = row.messages[0];

  if (markdown === "" || first === undefined) return null;

  const worked = row.ended && row.workedMs !== undefined ? workedFor(row.workedMs) : undefined;

  const commit = row.messages
    .flatMap((message) => (message.status.kind === "settled" ? [message.status.commit] : []))
    .at(-1);

  return (
    <div {...props(replyStyles.reply, row.ended && row.latest && replyStyles.latest)}>
      {worked !== undefined && <span {...props(stepGroupStyles.status)}>{worked}</span>}
      <Prose markdown={markdown} streaming={streaming} />
      {row.ended && (
        <ReplyActions markdown={markdown} at={first.at} worked={worked} commit={commit} />
      )}
    </div>
  );
}

const SENT_AT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function ReplyActions({
  markdown,
  at,
  worked,
  commit,
}: {
  markdown: string;
  at: number;
  worked: string | undefined;
  commit: CommitId | undefined;
}): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const confirmation = useCopyConfirmation();
  const now = useNowMinute();
  const sent = new Date(at);
  const full = SENT_AT.format(sent);

  return (
    <div {...props(text.sm, replyStyles.actions)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              icon={confirmation.copied ? "checkmark" : "copy"}
              data-copied={confirmation.copied || undefined}
              aria-label="Copy reply"
              onClick={() => confirmation.copy(markdown)}
            />
          }
        />
        <TooltipContent>{confirmation.copied ? "Copied" : "Copy reply"}</TooltipContent>
      </Tooltip>
      {sessionId !== undefined && commit !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                icon="fork"
                aria-label="Fork chat from here"
                onClick={() => void forkChat(sessionId, commit)}
              />
            }
          />
          <TooltipContent>Fork chat from here</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <time dateTime={sent.toISOString()} {...props(replyStyles.time)}>
              <span aria-hidden="true">{replyAge(at, now)}</span>
              <span {...props(srOnly)}>Message sent {full}</span>
            </time>
          }
        />
        <TooltipContent>
          {full}
          {worked !== undefined && (
            <>
              <br />
              {worked}
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function TurnItemView({
  row,
  running,
  density,
  cwd,
  onEditUser,
  branchModel,
}: {
  row: TurnItemRow | PromptRow;
  running: boolean;
  density: ToolCallDensity;
  cwd: string | undefined;
  onEditUser?: (
    message: UserMessage,
    content: UserContent,
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
}): ReactElement | null {
  switch (row.kind) {
    case "prompt":
      return (
        <TurnPartView message={row.message} pending={row.pending} cwd={cwd} density={density} />
      );
    case "part":
      return (
        <TurnPartView
          message={row.message}
          cwd={cwd}
          density={density}
          onEditUser={onEditUser}
          branchModel={branchModel}
        />
      );
    case "step": {
      const [first] = row.messages;

      if (!running && row.messages.length === 1 && first !== undefined && showsTool(first))
        return <TurnPartView message={first} cwd={cwd} density={density} />;

      return (
        <StepGroupView
          messages={row.messages}
          cwd={cwd}
          added={row.added}
          removed={row.removed}
          running={running}
          density={density}
        />
      );
    }

    case "agents":
      return <SubagentGroupView messages={row.messages} cwd={cwd} />;
    case "response":
      return <ResponseView row={row} />;
    case "failure": {
      const failure = failureNotice(row.failure);

      return (
        <StatusMarker
          role={failure.tone === "danger" ? "alert" : "status"}
          variant={failure.tone === "danger" ? "destructive" : "default"}
        >
          {failure.text}
          {failure.recovery !== undefined && (
            <>
              {" "}
              <RecoveryAction recovery={failure.recovery} />
            </>
          )}
        </StatusMarker>
      );
    }

    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}
