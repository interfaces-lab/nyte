/** A new chat in a pane: its draft composer, until the first message starts the chat. */
import { threadStyles } from "./thread.stylex.ts";
import { modelConfiguration } from "./model-configuration.ts";
import { PaneHeader } from "./pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement } from "react";
import { SdkError } from "@nyte-ai/sdk";
import type { CommandInfo, Delivery } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { ComposerFrame } from "../conversation/composer-frame.tsx";
import { attachComposerFiles } from "../conversation/composer-files.ts";
import { composerSource } from "../conversation/composer-suggestions.tsx";
import { bindComposerFileDrop } from "../conversation/composer-file-drop.ts";
import type {
  ComposerDocumentState,
  ComposerSubmission,
} from "../conversation/composer-document.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { composerSendPlan, startComposerChat } from "../conversation/composer-send.ts";
import { ModelPicker } from "../conversation/model-picker.tsx";
import { WorkspaceContext } from "./workspace-context.tsx";
import {
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../layout/pane-context.tsx";
import { activePane } from "../layout/pane-layout.ts";
import type { PaneId } from "../layout/pane-layout.ts";
import type { BlankViewState, ChatDraft } from "../layout/session-view-state.ts";
import { useCatalog, useHostState, useMentionFiles, useSetPreference } from "../queries.ts";
import { connected, sessionWatch } from "../sdk.tsx";

import { errorMessage } from "../errors.ts";
import { pickerDefaults } from "../preference-projection.ts";
import { selectedModelOption } from "../conversation/model-picker-state.ts";

const NO_COMMANDS: readonly CommandInfo[] = [];

type BlankViewUpdate = (current: BlankViewState) => BlankViewState;

/**
 * A pane's new-chat draft and its writer. A detached composer can still
 * commit; its writes belong to the draft it showed, so a write for another
 * draft is dropped.
 */
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

  const update = useCallback(
    (change: BlankViewUpdate): void => {
      const current = store.readBlank(paneId);

      if (current.id !== draftId) return;
      store.writeBlank(paneId, change(current));
      redraw();
    },
    [draftId, paneId, store],
  );

  return [state, update];
}

/**
 * A new chat: the draft composer until the first message starts the chat
 * and the pane moves to it once its first view arrived. A failed start that
 * left a chat under the draft's id opens that chat; when another start took
 * the id, the message waits in that chat's composer. A failed start's raw
 * cause is diagnostic only: it rides in `title`, never in body copy.
 */
export function BlankConversation({
  paneId,
  inputRef,
}: {
  paneId: PaneId;
  inputRef: (element: ComposerEditorHandle | null) => void;
}): ReactElement {
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const workspace = host.data?.workspace;
  const catalog = useCatalog();
  const workspaceFiles = useMentionFiles(workspace !== undefined);
  const actions = usePaneActions();
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);

  const [startFailure, setStartFailure] = useState<
    | { readonly kind: "start"; readonly cause: string }
    | { readonly kind: "refused"; readonly message: string }
  >();

  const [sending, setSending] = useState(false);

  const attachments = viewState.composer.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const blankRef = useRef<HTMLDivElement>(null);

  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef(handle);
    },
    [inputRef],
  );

  const setPreference = useSetPreference();
  const defaults = catalog.data?.defaults;

  const selected = selectedModelOption(catalog.data?.models ?? [], defaults?.model);
  const current = selected?.option;

  const start = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    if (sending || attachmentReads !== 0) return false;

    const plan = composerSendPlan({ submission, attachments, commands: [], delivery });

    if (plan.kind !== "message") return false;
    setSending(true);
    setStartFailure(undefined);

    const submitted = viewStore.takeBlank(paneId, {
      ...viewStore.readBlank(paneId).composer,
      draft: document.text,
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
    });

    const id = asId<"session">(submitted.id);

    try {
      const connection = await connected();

      await startComposerChat(
        connection,
        {
          id,
          ...(workspace !== undefined && { workspace: workspace.id }),
          ...(defaults !== undefined && {
            configuration: modelConfiguration(defaults.model, defaults.thinkingLevel),
          }),
        },
        plan,
      );

      await sessionWatch(id)
        .next()
        .catch(() => undefined);
      setAttachmentError(undefined);
      setSending(false);
      actions.openSessionInPane(paneId, id);

      return true;
    } catch (cause: unknown) {
      const started = await connected()
        .then((connection) => connection.session(id).info())
        .then(
          () => true,
          () => false,
        );

      setSending(false);

      if (started) {
        if (cause instanceof SdkError && cause.code === "invalid")
          viewStore.updateSession(id, paneId, (state) => ({
            ...state,
            composer: submitted.composer,
          }));
        actions.openSessionInPane(paneId, id);

        return true;
      }

      viewStore.restoreBlank(paneId, submitted);

      setStartFailure(
        cause instanceof SdkError && cause.code === "invalid"
          ? { kind: "refused", message: cause.message }
          : { kind: "start", cause: errorMessage(cause) },
      );

      return false;
    }
  };

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
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
    },
    [updateViewState],
  );

  const dropDisabled = sending || host.data === undefined;
  useLayoutEffect(() => {
    const element = blankRef.current;

    if (element === null) return undefined;

    return bindComposerFileDrop({
      element,
      disabled: dropDisabled,
      onFiles: (files) => {
        void addFiles(files);
      },
    });
  }, [addFiles, dropDisabled]);

  return (
    <div {...props(threadStyles.screen)}>
      {layout.kind === "split" && <PaneHeader paneId={paneId} title="New chat" />}
      <div ref={blankRef} {...props(threadStyles.blank)}>
        <div {...props(threadStyles.blankColumn)}>
          <WorkspaceContext active={activePane(layout).id === paneId} />
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
            disabled={sending || host.data === undefined}
            suggestionCatalog={composerSource({ commands: NO_COMMANDS, skills: [] }, false)}
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
                thinkingLevel={defaults?.thinkingLevel}
                fast={selected?.fast === true}
                disabled={sending || host.data === undefined}
                onChange={(change) => {
                  const model = pickerDefaults(
                    {
                      model: current,
                      thinkingLevel: defaults?.thinkingLevel,
                      fast: selected?.fast === true,
                    },
                    change,
                  );

                  if (model !== undefined) setPreference.mutate(model);
                }}
              />
            }
          />
          {startFailure !== undefined && (
            <div
              role="alert"
              title={startFailure.kind === "start" ? startFailure.cause : undefined}
              {...props(intent.danger, threadStyles.error)}
            >
              {startFailure.kind === "start"
                ? "Couldn’t start the chat. Try again."
                : startFailure.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
