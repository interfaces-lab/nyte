import { sessionScreenStyles } from "../../panes/session-screen.stylex.ts";
import { PaneHeader } from "../../panes/pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Delivery } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { ComposerFrame } from "./composer-frame.tsx";
import { NO_INTAKE, nextIntake, takeFiles } from "./composer-files.ts";
import type { ComposerFile } from "../../references/composer-file-drop.ts";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "../../references/composer-file-drop.ts";
import type { ComposerDocumentState, ComposerSubmission } from "../../panes/composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { composerSendPlan } from "./composer-plan.ts";
import { omittedMessage } from "../../panes/composer-draft.ts";
import { startDraft } from "./draft-start.ts";
import { ModelPicker } from "./model-picker.tsx";
import {
  cycleModes,
  modeControl,
  modeTriggers,
  readModes,
  runModeTrigger,
} from "./composer-modes.tsx";
import { WorkspaceContext } from "../../panes/workspace-context.tsx";
import {
  usePaneActions,
  usePaneFocused,
  useSplitPanes,
  usePaneViewStateStore,
} from "../../panes/pane-context.tsx";
import type { PaneId } from "../../panes/layout.ts";
import type { BlankViewState, ChatDraft } from "../../panes/session-view-state.ts";
import { useCatalog } from "../../data/catalog.ts";
import { useHostState } from "../../data/host.ts";
import { useMentionFiles } from "../../data/files.ts";
import { useProjects } from "../../data/projects.ts";
import { useHomeWorkspace } from "../../data/workspaces.ts";
import { preferences } from "../../preferences/index.ts";
import { useWorkspaceCatalog } from "../../data/plugins.ts";
import { draftModel, modelRefFor, selectedModelOption } from "./model-picker-state.ts";
import { useChatFolder } from "../../chats/index.ts";
import { ChatScope } from "../chat-scope.tsx";

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

export function BlankConversation(conversation: BlankConversationProps): ReactElement {
  return (
    <ChatScope folder={useHostState().data.workspace}>
      <BlankScreen {...conversation} />
    </ChatScope>
  );
}

function BlankScreen({ paneId, inputRef }: BlankConversationProps): ReactElement {
  const split = useSplitPanes();
  const focused = usePaneFocused(paneId);
  const workspace = useChatFolder();
  const catalog = useCatalog();
  const home = useHomeWorkspace();
  const scansFiles = workspace !== undefined && workspace.id !== home;
  const mentions = useMentionFiles(workspace, scansFiles);
  const catalogWorkspace = workspace?.id ?? home ?? undefined;
  const workspaceCatalog = useWorkspaceCatalog(catalogWorkspace);
  const actions = usePaneActions();
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);
  const { status } = viewState;

  const project = useProjects().find(
    (entry) => entry.id === viewState.project && entry.workspace === workspace?.id,
  );

  const held = status.kind === "waiting" || status.kind === "starting";
  const [pickerOpen, setPickerOpen] = useState(false);
  const modes = {
    modes: readModes(workspaceCatalog.data?.modes, viewState.modes),
    set: (values: Readonly<Record<string, boolean>>) =>
      updateViewState((state) => ({ ...state, modes: values })),
  };

  const attachments = viewState.composer.attachments;
  const [intake, setIntake] = useState(NO_INTAKE);
  const editorRef = useRef<ComposerEditorHandle | null>(null);

  const attachInput = (handle: ComposerEditorHandle | null) => {
    editorRef.current = handle;
    inputRef(handle);
  };

  const { choice } = viewState;

  const selected = selectedModelOption(
    catalog.data?.models ?? [],
    draftModel(choice, project, catalog.data?.defaults),
  );

  const current = selected?.option;

  const triggers = modeTriggers(modes, []);

  const start = (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): void | Promise<void> => {
    if (intake.reads !== 0) return;

    if (runModeTrigger({ modes, triggers, editor: editorRef.current, text: document.text })) return;

    const plan = composerSendPlan({ submission, attachments, commands: [], delivery });

    if (plan.kind !== "message") return;
    updateViewState((state) => ({
      ...state,
      modes:
        workspaceCatalog.data !== undefined
          ? Object.fromEntries(modes.modes.filter((mode) => mode.on).map((mode) => [mode.id, true]))
          : Object.fromEntries(Object.entries(state.modes ?? {}).filter(([, on]) => on)),
    }));
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

  const addFiles = (
    files: readonly ComposerFile[],
    signal?: AbortSignal,
  ): Promise<string | undefined> =>
    takeFiles({
      files,
      editor: editorRef.current,
      signal,
      step: (event) => setIntake((current) => nextIntake(current, event)),
      attach: (taken) =>
        updateViewState((state) => ({
          ...state,
          composer: { ...state.composer, attachments: [...state.composer.attachments, ...taken] },
        })),
    });

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
      {split && <PaneHeader paneId={paneId} title="New chat" />}
      <div
        ref={bindFileDrop}
        {...props(sessionScreenStyles.blank)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || status.kind !== "waiting") return;
          event.preventDefault();
          viewStore.cancelSend(viewState.id);
        }}
      >
        <div {...props(sessionScreenStyles.blankColumn)}>
          <WorkspaceContext
            active={focused}
            onChoose={(folder) => {
              updateViewState((state) => ({ ...state, folder }));
              preferences.draftFolder.set(folder);
            }}
          />
          {project !== undefined && (
            <div {...props(sessionScreenStyles.blankHint)}>
              {`${project.name}: tell the coordinator what to work on.`}
            </div>
          )}
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
              catalogWorkspace === undefined
                ? { status: "ready", data: { commands: triggers, skills: [] } }
                : composerSource(
                    workspaceCatalog.data && { ...workspaceCatalog.data, commands: triggers },
                    workspaceCatalog.isError,
                  )
            }
            mentionFiles={
              scansFiles
                ? composerSource(mentions.data, mentions.isError)
                : { status: "ready", data: [] }
            }
            attachments={attachments}
            attachmentBusy={intake.reads !== 0}
            attachmentError={
              intake.error ??
              (viewState.omitted === 0 ? undefined : omittedMessage(viewState.omitted))
            }
            onFilesSelected={addFiles}
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
              setIntake((current) => nextIntake(current, { kind: "cleared" }));
            }}
            inputRef={attachInput}
            onCycleMode={cycleModes(modes)}
            modes={modeControl(modes)}
            model={
              <ModelPicker
                catalog={catalog.data}
                current={current}
                thinkingLevel={choice?.thinking}
                modes={selected?.modes ?? []}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(change) =>
                  updateViewState((state) => ({
                    ...state,
                    choice: {
                      model: modelRefFor(change.option, change.modes),
                      thinking: change.thinkingLevel,
                    },
                  }))
                }
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
