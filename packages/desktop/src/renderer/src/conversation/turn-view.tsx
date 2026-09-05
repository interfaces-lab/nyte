/**
 * One transcript item. User prompts are the only ordinary contained message
 * region. Assistant prose stays flat, while reasoning, tools, and system
 * history use compact rows. Parts keep core's stable identity so settled and
 * streaming content exchange in place.
 */
import * as stylex from "@stylexjs/stylex";
import { Button as BaseButton, Textarea } from "@nyte-ai/ui";
import { Collapsible } from "@nyte-ai/ui/primitives";
import { memo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { presentNote, turnPartId } from "@nyte-ai/core/views";
import type { ThinkingLevel, Turn, TurnPart, UserTurnPart } from "@nyte-ai/core";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { Prose } from "./prose.tsx";
import { ImagePreview } from "./image-preview.tsx";
import { ModelPicker } from "./model-picker.tsx";
import type { ModelPickerChange } from "./model-picker.tsx";
import { inlineTextStyles, turnStyles } from "./styles.stylex.ts";
import { ToolCallView } from "./tool-call.tsx";
import { WorkGroupView } from "./tool-group.tsx";
import {
  configChangeText,
  displayTranscriptParts,
  isFailureNotice,
  presentTranscriptNotice,
  userDisplayText,
  userTextSegments,
} from "./transcript-presentation.ts";
import { errorMessage } from "../../../shared/errors.ts";
import type { DesktopCatalog, DesktopModelOption } from "../nyte.ts";

export interface BranchModelChoice {
  readonly model: DesktopModelOption | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly fastEnabled: ReadonlySet<string>;
}

export interface BranchModelPicker extends BranchModelChoice {
  readonly catalog: DesktopCatalog | undefined;
}

function UserMessageContent({ content }: { content: UserTurnPart["content"] }): ReactElement {
  const segments = userTextSegments(editableText(content));
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={`text:${String(index)}`}>{segment.text}</span>
        ) : (
          <span
            key={`reference:${String(index)}:${segment.label}`}
            title={segment.target}
            {...stylex.props(inlineTextStyles.skill)}
          >
            {segment.label}
          </span>
        ),
      )}
    </>
  );
}

function editableText(content: UserTurnPart["content"]): string {
  if (!Array.isArray(content)) return content;
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function replaceText(content: UserTurnPart["content"], text: string): UserTurnPart["content"] {
  if (!Array.isArray(content)) return text;
  let inserted = false;
  const next: Exclude<UserTurnPart["content"], string> = [];
  for (const part of content) {
    if (part.type === "image") {
      next.push(part);
      continue;
    }
    if (inserted) continue;
    inserted = true;
    if (text !== "") next.push({ type: "text", text });
  }
  if (!inserted && text !== "") next.unshift({ type: "text", text });
  return next;
}

interface UserEditState extends BranchModelChoice {
  readonly draft: string;
  readonly saving: boolean;
  readonly error: string | undefined;
}

function focusAtEnd(input: HTMLTextAreaElement | null): void {
  if (input === null) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  input.style.height = "auto";
  input.style.height = `${String(Math.min(input.scrollHeight, 180))}px`;
}

/**
 * One user row. Without `onEdit` it is read-only, which also draws a message
 * that has left the composer but has no commit yet.
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
  const original = editableText(content);

  const begin = (): void => {
    if (onEdit === undefined || edit !== undefined) return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    setEdit({
      draft: original,
      saving: false,
      error: undefined,
      model: branchModel?.model,
      thinkingLevel: branchModel?.thinkingLevel,
      fastEnabled: new Set(branchModel?.fastEnabled),
    });
  };

  const save = (): void => {
    if (edit === undefined || edit.saving || onEdit === undefined) return;
    const next = replaceText(content, edit.draft);
    if (Array.isArray(next) ? next.length === 0 : next.trim() === "") {
      setEdit({ ...edit, error: "A message cannot be empty." });
      return;
    }
    setEdit({ ...edit, saving: true, error: undefined });
    void onEdit(next, {
      model: edit.model,
      thinkingLevel: edit.thinkingLevel,
      fastEnabled: edit.fastEnabled,
    })
      .then(() => setEdit(undefined))
      .catch((cause: unknown) => {
        setEdit((current) =>
          current === undefined
            ? current
            : {
                ...current,
                saving: false,
                error: errorMessage(cause),
              },
        );
      });
  };

  return (
    <div data-sticky-user-message {...stylex.props(turnStyles.userRow)}>
      <div {...stylex.props(turnStyles.userPromptShell)}>
        {onEdit === undefined ? (
          <div {...stylex.props(turnStyles.userPrompt)}>
            <UserMessageContent content={content} />
          </div>
        ) : edit === undefined ? (
          <BaseButton
            unstyled
            type="button"
            aria-label={
              original === "" ? "Edit message" : `Edit message: ${userDisplayText(original)}`
            }
            {...stylex.props(turnStyles.userPrompt, turnStyles.userPromptEditable, focus.ring)}
            onClick={begin}
            onKeyDown={(event) => {
              if (event.key !== "F2") return;
              event.preventDefault();
              begin();
            }}
          >
            <UserMessageContent content={content} />
          </BaseButton>
        ) : (
          <form
            aria-busy={edit.saving || undefined}
            {...stylex.props(turnStyles.userEdit)}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Textarea
              unstyled
              ref={focusAtEnd}
              aria-label="Edit message"
              rows={1}
              value={edit.draft}
              disabled={edit.saving}
              {...stylex.props(turnStyles.userEditInput)}
              onChange={(event) => {
                setEdit({ ...edit, draft: event.target.value, error: undefined });
                event.target.style.height = "auto";
                event.target.style.height = `${String(Math.min(event.target.scrollHeight, 180))}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEdit(undefined);
                } else if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  save();
                }
              }}
            />
            <div {...stylex.props(turnStyles.userEditFooter)}>
              {branchModel !== undefined && (
                <ModelPicker
                  catalog={branchModel.catalog}
                  current={edit.model}
                  thinkingLevel={edit.thinkingLevel}
                  fastEnabled={edit.fastEnabled}
                  disabled={edit.saving}
                  onChange={(change: ModelPickerChange) => {
                    switch (change.kind) {
                      case "model":
                        setEdit({
                          ...edit,
                          model: change.option,
                          thinkingLevel: change.thinkingLevel,
                        });
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
              )}
              {edit.error !== undefined && (
                <span role="alert" title={edit.error} {...stylex.props(turnStyles.userEditError)}>
                  {edit.error}
                </span>
              )}
              <div {...stylex.props(turnStyles.userEditActions)}>
                <BaseButton
                  unstyled
                  type="button"
                  disabled={edit.saving}
                  {...stylex.props(turnStyles.userEditCancel, focus.ring)}
                  onClick={() => setEdit(undefined)}
                >
                  Cancel
                </BaseButton>
                <BaseButton
                  unstyled
                  type="submit"
                  aria-label="Send edited message"
                  disabled={edit.saving}
                  {...stylex.props(turnStyles.userEditSubmit, focus.ring)}
                >
                  <Icon name={edit.saving ? "loader" : "arrow-up"} size={14} />
                </BaseButton>
              </div>
            </div>
          </form>
        )}
        {Array.isArray(content) && content.some((item) => item.type === "image") && (
          <div aria-label="Image attachments" {...stylex.props(turnStyles.userImages)}>
            {content.map((item, index) =>
              item.type === "image" ? (
                <ImagePreview
                  key={index}
                  src={`data:${item.mimeType};base64,${item.data}`}
                  name={`Image ${String(index + 1)}`}
                />
              ) : null,
            )}
          </div>
        )}
      </div>
      <div aria-hidden="true" data-sticky-message-fade {...stylex.props(turnStyles.userFade)} />
    </div>
  );
}

export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}): ReactElement {
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

function EventLine({ children }: { children: ReactNode }): ReactElement {
  return (
    <div role="status" {...stylex.props(turnStyles.event)}>
      {children}
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
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} {...stylex.props(turnStyles.history)}>
      <Collapsible.Trigger {...stylex.props(turnStyles.historyToggle, focus.ring)}>
        <span {...stylex.props(turnStyles.historyChevron, open && turnStyles.historyChevronOpen)}>
          <Icon name="chevron-right" size={11} />
        </span>
        {label}
      </Collapsible.Trigger>
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

export function TurnPartView({
  part,
  liveTools,
  cwd,
  toolCalls,
  onEditUser,
  branchModel,
}: {
  part: TurnPart;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  cwd: string | undefined;
  toolCalls: ToolCallDensity;
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
  running = false,
}: {
  turn: Turn;
  liveTools: ReadonlyMap<string, LiveToolProgress>;
  live?: LiveSnapshot;
  cwd: string | undefined;
  onEditUser?: (
    part: UserTurnPart,
    content: UserTurnPart["content"],
    choice: BranchModelChoice,
  ) => Promise<void>;
  branchModel?: BranchModelPicker;
  running?: boolean;
}): ReactElement | null {
  const appearance = useAppearanceSettings();
  switch (turn.kind) {
    case "turn": {
      const hasFailureNote = turn.parts.some(
        (part) => part.kind === "note" && isFailureNotice(part.text),
      );
      return (
        <div
          data-sticky-turn={turn.parts.some((part) => part.kind === "user") || undefined}
          {...stylex.props(turnStyles.turn)}
        >
          {displayTranscriptParts(turn.parts).map((item) => {
            if (item.kind === "work") {
              const first = item.parts[0];
              return (
                <WorkGroupView
                  key={`work:${first === undefined ? turn.id : turnPartId(first)}`}
                  parts={item.parts}
                  live={live}
                  liveTools={liveTools}
                  cwd={cwd}
                  durationMs={turn.durationMs}
                  running={running}
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
                onEditUser={onEditUser}
                branchModel={branchModel}
              />
            );
          })}
          {turn.outcome === "aborted" && !hasFailureNote && <Notice text="Run stopped." />}
          {turn.outcome === "failed" && !hasFailureNote && <Notice text="Error: Run failed." />}
        </div>
      );
    }
    case "checkpoint":
      return (
        <HistoryDisclosure
          label={
            <>
              <Icon name="sparkle" size={12} />
              Chat context summarized
            </>
          }
        >
          <Prose markdown={turn.body.summary} />
        </HistoryDisclosure>
      );
    case "summary":
      return (
        <HistoryDisclosure label="Branch summary">
          <Prose markdown={turn.body.text} />
        </HistoryDisclosure>
      );
    case "config": {
      const text = configChangeText(turn);
      return text === undefined ? null : <EventLine>{text}</EventLine>;
    }
    case "note":
      return <Notice text={presentNote(turn).text} />;
    default: {
      const _exhaustive: never = turn;
      return _exhaustive;
    }
  }
});
