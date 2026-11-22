import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { BubbleContent } from "@nyte-ai/ui/bubble";
import { Message } from "@nyte-ai/ui/message";
import { AttachmentGroup } from "@nyte-ai/ui/attachment";
import { useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { flushSync } from "react-dom";
import type { Message as ViewMessage, UserContent } from "@nyte-ai/sdk";
import { failureNotice, showsThinking, showsTool } from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { drawPart } from "../../canvas/client-plugins.tsx";
import { useTranscriptControls, useTranscriptScope } from "./transcript.tsx";
import type { ModelMode, ModelThinkingLevel } from "@nyte-ai/schema/model";
import { isPart, branchSummary, compaction } from "@nyte-ai/plugin/client";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { useMentionFiles } from "../../data/files.ts";
import { usePluginCatalog } from "../../data/plugins.ts";
import { Prose } from "../../markdown/prose.tsx";
import { SubagentGroupView, SubagentReportLine } from "../tools/subagent-call.tsx";
import { ResponseView } from "./reply-view.tsx";
import { AnswerLine } from "./answer-line.tsx";
import { ActionLine } from "./action-line.tsx";
import type { ComposerSubmission } from "../composer/composer-document.ts";
import { ComposerFrame } from "../composer/composer-frame.tsx";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { attachComposerFiles } from "../composer/composer-files.ts";
import type { ComposerFile } from "../../references/composer-file-drop.ts";
import { useChatFolder } from "../../chats/index.ts";
import { composerMessageContent } from "../composer/composer-plan.ts";
import { uploadComposerContent } from "../composer/composer-send.ts";
import { composerSource } from "../composer/composer-suggestions.tsx";
import { BlobImage, UserMessageText, messageImages } from "./message-content.tsx";
import { contentDraftText } from "../../references/message-references.ts";
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
import { StepEntryView, StepGroupFactsView } from "./step-group.tsx";
import { stepRowView, userRowView } from "./transcript-row-views.ts";
import type { UserRowView } from "./transcript-row-views.ts";
import { liveTurnStyles } from "./live-turn.tsx";
import { ThinkingLine } from "./thinking-line.tsx";
import { userDisplayText } from "./transcript-presentation.ts";
import type { PromptRow, TurnItemRow } from "./transcript-rows.ts";
import { errorMessage } from "../../contract/errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../../data/catalog.ts";
import { beginEdit, decideSave, dismissible, nextEdit } from "./user-edit.ts";
import type { UserEditEvent, UserEditState } from "./user-edit.ts";

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

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the message before paint for the expand control; the observer's first report arrives after the frame's own layout, so the read forces none
  useLayoutEffect(() => {
    const content = contentRef.current;

    if (content === null) return undefined;

    const observer = new ResizeObserver(() => {
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      flushSync(() =>
        setOverflowing(content.scrollHeight > lineHeight * USER_MESSAGE_PREVIEW_LINES),
      );
    });

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
  readonly modes: readonly ModelMode[];
}

export interface BranchModelPicker extends BranchModelChoice {
  readonly catalog: DesktopCatalog | undefined;
}

type EditUserMessage = (
  message: UserMessage,
  content: UserContent,
  choice: BranchModelChoice,
) => Promise<void>;

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

  const canDismissEdit = edit !== undefined && dismissible(edit, content, branchModel);

  const keepWhileEditing = (element: HTMLDivElement | null): (() => void) | undefined =>
    element === null ? undefined : transcript.keep(element);

  const pluginCatalog = usePluginCatalog(useTranscriptScope()?.sessionId);
  const mentions = useMentionFiles(useChatFolder(), edit !== undefined);

  const begin = (): void => {
    if (rowRef.current !== null) transcript.hold(rowRef.current);
    editGeneration.current += 1;
    flushSync(() => setEdit(beginEdit(content, branchModel)));
    editorRef.current?.focus({ preventScroll: true });
  };

  const cancel = (): void => {
    flushSync(() => setEdit(undefined));
    editButtonRef.current?.focus({ preventScroll: true });
  };

  const patchEdit = (event: UserEditEvent): void => {
    setEdit((current) => (current === undefined ? current : nextEdit(current, event)));
  };

  const addFiles = async (
    files: readonly ComposerFile[],
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    const generation = editGeneration.current;

    const patchSameEdit = (event: UserEditEvent): void => {
      if (generation === editGeneration.current) patchEdit(event);
    };

    patchSameEdit({ kind: "reading", delta: 1 });

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        signal?.throwIfAborted();
        patchSameEdit({ kind: "attached", attachments: result.attachments, error: result.error });

        return result.error;
      })
      .finally(() => patchSameEdit({ kind: "reading", delta: -1 }));
  };

  const save = async (submission: ComposerSubmission): Promise<void> => {
    if (edit === undefined || onEdit === undefined) return;
    const draft = composerMessageContent(submission.parts, edit.attachments, edit.kept);
    const decision = decideSave(edit, draft);

    if (decision.kind === "busy") return;
    setEdit(decision.edit);

    if (decision.kind === "empty") return;
    const messages = rowRef.current?.closest<HTMLElement>('[role="region"]');

    const failure = await uploadComposerContent(draft)
      .then((next) => onEdit(next, decision.choice))
      .then(
        () => undefined,
        (cause: unknown) => errorMessage(cause),
      );

    if (failure !== undefined) {
      patchEdit({ kind: "failed", error: failure });

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
        modes={edit.modes}
        disabled={edit.saving}
        onChange={(change: ModelPickerChange) => patchEdit({ kind: "model", change })}
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
                if (document.text !== edit.document.text && rowRef.current !== null) {
                  transcript.reveal(rowRef.current);
                }
                patchEdit({ kind: "document", document });
              }}
              onSubmit={save}
              placeholder="Edit message"
              disabled={edit.saving}
              suggestionCatalog={composerSource(pluginCatalog.data, pluginCatalog.isError)}
              mentionFiles={composerSource(mentions.data, mentions.isError)}
              hasConversationContext
              attachments={edit.attachments}
              keptFiles={edit.kept}
              onKeptFileRemove={(file) => patchEdit({ kind: "removed-kept", file })}
              attachmentBusy={edit.attachmentReads !== 0}
              attachmentError={edit.attachmentError}
              onFilesSelected={addFiles}
              onAttachmentRemove={(id) => patchEdit({ kind: "removed-attachment", id })}
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

    let pressStartedInPopup = false;

    const press = (event: PointerEvent): void => {
      pressStartedInPopup = insidePopup(event.target);
    };

    const listener = (event: MouseEvent): void => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        pressStartedInPopup ||
        insidePopup(event.target) ||
        event.composedPath().includes(row)
      ) {
        return;
      }
      dismiss();
    };

    row.ownerDocument.addEventListener("pointerdown", press, true);
    row.ownerDocument.addEventListener("click", listener);

    return () => {
      row.ownerDocument.removeEventListener("pointerdown", press, true);
      row.ownerDocument.removeEventListener("click", listener);
    };
  });

  return null;
}

function insidePopup(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="menu"], [role="listbox"], [role="dialog"], [data-base-ui-inert]') !==
      null
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

function NoteView({ message }: { message: ViewMessage }): ReactElement | null {
  const sessionId = useTranscriptScope()?.sessionId;

  if (isPart(message, compaction)) {
    if (message.status.kind === "live") {
      return (
        <StatusMarker role="status" variant="retrying">
          Summarizing chat context…
        </StatusMarker>
      );
    }

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
}: {
  message: ViewMessage;
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement | null {
  if (showsThinking(message)) {
    return <ThinkingLine message={message} text={message.state.markdown} />;
  }

  if (showsTool(message)) return <ToolCallView message={message} cwd={cwd} density={density} />;

  return <NoteView message={message} />;
}

function userRow(
  view: UserRowView,
  onEditUser: EditUserMessage | undefined,
  branchModel: BranchModelPicker | undefined,
): ReactElement {
  switch (view.kind) {
    case "report": {
      const line = (
        <SubagentReportLine source={view.source} content={view.content} held={view.held} />
      );

      return view.wrapped ? <div {...props(liveTurnStyles.root)}>{line}</div> : line;
    }

    case "answer": {
      const line = <AnswerLine message={view.message} held={view.held} />;

      return view.wrapped ? <div {...props(liveTurnStyles.root)}>{line}</div> : line;
    }

    case "action": {
      const line = <ActionLine label={view.label} held={view.held} />;

      return view.wrapped ? <div {...props(liveTurnStyles.root)}>{line}</div> : line;
    }

    case "user": {
      const message = view.message;

      return (
        <UserMessageView
          content={view.content}
          pending={view.pending}
          onEdit={
            onEditUser === undefined || !view.editable
              ? undefined
              : (content, choice) => onEditUser(message, content, choice)
          }
          branchModel={branchModel}
        />
      );
    }

    default: {
      const _exhaustive: never = view;

      return _exhaustive;
    }
  }
}

export function TurnItemView({
  row,
  density,
  cwd,
  onEditUser,
  branchModel,
}: {
  row: TurnItemRow | PromptRow;
  density: ToolCallDensity;
  cwd: string | undefined;
  onEditUser?: EditUserMessage;
  branchModel?: BranchModelPicker;
}): ReactElement | null {
  switch (row.kind) {
    case "prompt":
    case "part": {
      const user = userRowView(row);

      return user === undefined ? (
        <TurnPartView message={row.message} cwd={cwd} density={density} />
      ) : (
        userRow(user, onEditUser, branchModel)
      );
    }

    case "step": {
      const step = stepRowView(row);

      if (step.kind === "entry") {
        return (
          <StepEntryView
            entry={step.entry}
            cwd={cwd}
            density={density}
            thinkingOnly={false}
            titled={false}
            live={false}
          />
        );
      }

      return (
        <StepGroupFactsView
          facts={step.facts}
          cwd={cwd}
          added={row.added}
          removed={row.removed}
          running={row.running}
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
