import { sessionScreenStyles } from "../../panes/session-screen.stylex.ts";
import { PaneHeader } from "../../panes/pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { CommandInfo, Delivery } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { ComposerFrame } from "./composer-frame.tsx";
import { attachComposerFiles } from "./composer-files.ts";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "../../references/composer-file-drop.ts";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { composerSendPlan } from "./composer-send.ts";
import { composerStyles } from "./composer.stylex.ts";
import { startDraft } from "./draft-start.ts";
import { ModelPicker } from "./model-picker.tsx";
import { ProjectMenu } from "../../projects/project-menu.tsx";
import { WorkspaceContext } from "../../panes/workspace-context.tsx";
import {
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
  useToastAnchor,
} from "../../panes/pane-context.tsx";
import { activePane } from "../../panes/pane-layout.ts";
import type { PaneId } from "../../panes/pane-layout.ts";
import type { BlankViewState, ChatDraft } from "../../panes/session-view-state.ts";
import { useCatalog } from "../../data/catalog.ts";
import { useHostState } from "../../data/host.ts";
import { useMentionFiles } from "../../data/files.ts";
import { useWorkspaceCatalog } from "../../data/plugins.ts";
import { modelRefFor, selectedModelOption } from "./model-picker-state.ts";
import { StartupReadsRelease } from "../../data/startup.ts";
import { useChatFolder } from "../chat-folder.ts";
import { ChatScope } from "../chat-scope.tsx";

const NO_COMMANDS: readonly CommandInfo[] = [];

type BlankViewUpdate = (current: BlankViewState) => BlankViewState;

function useBlankViewBinding(
  paneId: PaneId,
): readonly [ChatDraft, (update: BlankViewUpdate) => void] {
  const store = usePaneViewStateStore();

  const state = useSyncExternalStore(
    store.subscribe,
    () => store.readBlank(paneId),
    () => store.readBlank(paneId),
  );

  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const draftId = state.id;

  const update = (change: BlankViewUpdate): void => {
    const current = store.readBlank(paneId);

    if (current.id !== draftId) return;
    store.writeBlank(paneId, change(current));
    redraw();
  };

  return [state, update];
}

interface BlankConversationProps {
  readonly paneId: PaneId;
  readonly inputRef: (element: ComposerEditorHandle | null) => void;
}

/** A new chat starts in the folder the window has open, so that is the folder it reads. */
export function BlankConversation(conversation: BlankConversationProps): ReactElement {
  return (
    <ChatScope folder={useHostState().data.workspace}>
      <BlankScreen {...conversation} />
    </ChatScope>
  );
}

function BlankScreen({ paneId, inputRef }: BlankConversationProps): ReactElement {
  const { layout } = usePaneControllerSnapshot();
  const toastAnchor = useToastAnchor(paneId, false);
  const workspace = useChatFolder();
  const catalog = useCatalog();
  const workspaceFiles = useMentionFiles(workspace, workspace !== undefined);
  const workspaceCatalog = useWorkspaceCatalog(workspace?.id);
  const actions = usePaneActions();
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);
  const { status } = viewState;
  const held = status.kind === "waiting" || status.kind === "starting";
  const [pickerOpen, setPickerOpen] = useState(false);
  const attachments = viewState.composer.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const editorRef = useRef<ComposerEditorHandle | null>(null);

  const attachInput = (handle: ComposerEditorHandle | null) => {
    editorRef.current = handle;
    inputRef(handle);
  };

  const { choice } = viewState;

  const selected = selectedModelOption(
    catalog.data?.models ?? [],
    choice?.model ?? catalog.data?.defaults?.model,
  );

  const current = selected?.option;

  const start = (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): void | Promise<void> => {
    if (attachmentReads !== 0) return;

    const plan = composerSendPlan({ submission, attachments, commands: [], delivery });

    if (plan.kind !== "message") return;
    const draft = viewStore.readBlank(paneId);

    const waiting = viewStore.beginSend(paneId, {
      ...draft.composer,
      draft: document.text,
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
    });

    if (waiting === undefined) return;

    return startDraft(viewStore, actions, draft.id, waiting, plan);
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setAttachmentReads((count) => count + 1);

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        if (result.attachments.length > 0) {
          updateViewState((state) => ({
            ...state,
            composer: {
              ...state.composer,
              attachments: [...state.composer.attachments, ...result.attachments],
            },
          }));
        }

        setAttachmentError(result.error);
      })
      .finally(() => setAttachmentReads((count) => count - 1));
  };

  const bindFileDrop = (element: HTMLDivElement | null): (() => void) | undefined =>
    element === null
      ? undefined
      : bindComposerFileDrop({
          element,
          disabled: held,
          onFiles: (files) => void addFiles(files),
        });

  return (
    <div {...props(sessionScreenStyles.screen)}>
      <StartupReadsRelease />
      {layout.kind === "split" && <PaneHeader paneId={paneId} title="New chat" />}
      <div
        ref={bindFileDrop}
        {...props(sessionScreenStyles.blank)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || status.kind !== "waiting") return;
          event.preventDefault();
          viewStore.cancelSend(viewState.id);
        }}
      >
        <div {...props(sessionScreenStyles.blankColumn, toastAnchor && composerStyles.toastAnchor)}>
          <WorkspaceContext active={activePane(layout).id === paneId}>
            <ProjectMenu
              folder={workspace?.id}
              value={viewState.project}
              onChange={(project) => updateViewState((state) => ({ ...state, project }))}
            />
          </WorkspaceContext>
          <ComposerFrame
            surface="new-chat"
            document={{
              text: viewState.composer.draft,
              selectionStart: viewState.composer.selectionStart,
              selectionEnd: viewState.composer.selectionEnd,
            }}
            onDocumentChange={(document) =>
              updateViewState((state) => ({
                ...state,
                composer: {
                  ...state.composer,
                  draft: document.text,
                  selectionStart: document.selectionStart,
                  selectionEnd: document.selectionEnd,
                },
              }))
            }
            onSubmit={start}
            placeholder="Ask Nyte, or type / for skills and @ for context"
            disabled={held}
            suggestionCatalog={
              workspace === undefined
                ? { status: "ready", data: { commands: NO_COMMANDS, skills: [] } }
                : composerSource(workspaceCatalog.data, workspaceCatalog.isError)
            }
            mentionFiles={
              workspace === undefined
                ? { status: "ready", data: [] }
                : composerSource(workspaceFiles.data, workspaceFiles.isError)
            }
            attachments={attachments}
            attachmentBusy={attachmentReads !== 0}
            attachmentError={attachmentError}
            onFilesSelected={(files) => void addFiles(files)}
            onAttachmentRemove={(id) => {
              updateViewState((state) => ({
                ...state,
                composer: {
                  ...state.composer,
                  attachments: state.composer.attachments.filter(
                    (attachment) => attachment.id !== id,
                  ),
                },
              }));
              setAttachmentError(undefined);
            }}
            inputRef={attachInput}
            onFocusChange={(focused) =>
              updateViewState((state) => ({
                ...state,
                composer: { ...state.composer, focused },
              }))
            }
            model={
              <ModelPicker
                catalog={catalog.data}
                current={current}
                thinkingLevel={choice?.thinking}
                fast={selected?.fast === true}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(change) => {
                  if (change.kind === "model") {
                    const model = { provider: change.option.provider, id: change.option.id };
                    updateViewState((state) => ({
                      ...state,
                      choice: { model, thinking: undefined },
                    }));

                    return;
                  }

                  if (current === undefined) return;
                  const fast = change.kind === "fast" ? change.enabled : selected?.fast === true;

                  updateViewState((state) => ({
                    ...state,
                    choice: {
                      model: modelRefFor(current, fast),
                      thinking:
                        change.kind === "thinking" ? change.thinkingLevel : state.choice?.thinking,
                    },
                  }));
                }}
              />
            }
          />
          {status.kind === "waiting" && (
            <div role="status" {...props(text.base, sessionScreenStyles.startRow)}>
              Sends when Nyte connects
              <Button variant="ghost" size="xs" onClick={() => viewStore.cancelSend(viewState.id)}>
                Cancel
              </Button>
            </div>
          )}
          {(status.kind === "refused" || status.kind === "failed") && (
            <div
              role="alert"
              title={status.kind === "failed" ? status.cause : undefined}
              {...props(
                intent.danger,
                sessionScreenStyles.error,
                status.kind === "refused" &&
                  status.fix !== undefined &&
                  sessionScreenStyles.startRow,
              )}
            >
              {status.kind === "failed" ? "Couldn’t start the chat. Try again." : status.message}
              {status.kind === "refused" && status.fix === "choose-model" && (
                <Button variant="ghost" size="xs" onClick={() => setPickerOpen(true)}>
                  Choose Model
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
