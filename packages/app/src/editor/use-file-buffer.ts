import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Ref } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { Document, WorkspaceId } from "@nyte-ai/sdk";
import { useSaveDocument } from "../data/documents.ts";
import type { useDocument } from "../data/documents.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { shareDocument } from "./document-channel.ts";
import { mirrorDraft } from "./draft-mirror.ts";
import {
  bufferState,
  createFileDocument,
  sameBufferState,
  settledContents,
} from "./file-document.ts";
import type { FileBuffer } from "./file-document.ts";
import type { FileEditorHandle } from "./file-editor.tsx";
import { holdDocument } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";
import { formatDocument } from "./format-document.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

const SETTLE_MS = 250;

/**
 * The tab's hold on its file's buffer: the buffer, its state and its settled text, kept in step with the disk, the
 * file store and the other windows, and the commands that save, discard and format it, which `ref` also gets.
 */
export function useFileBuffer(input: {
  readonly ref: Ref<FileEditorHandle> | undefined;
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly document: TextFile;
  readonly autoSave: boolean;
  readonly reload: ReturnType<typeof useDocument>["refetch"];
  readonly workspace: WorkspaceId | undefined;
  readonly project: { readonly id: WorkspaceId; readonly path: string } | undefined;
}) {
  const { viewKey, file, document, autoSave, reload, workspace, project } = input;

  const [buffer] = useState(() => {
    const create = (): FileBuffer => createFileDocument(document);

    return holdDocument({ view: viewKey, path: file.path, holder: `tab:${file.id}`, create })
      .buffer;
  });

  const snapshot = useSyncExternalStoreWithSelector(
    buffer.subscribe,
    buffer.getSnapshot,
    buffer.getSnapshot,
    bufferState,
    sameBufferState,
  );

  const [settled] = useState(() => settledContents(buffer, SETTLE_MS));

  const settledText = useSyncExternalStore(
    settled.subscribe,
    settled.getSnapshot,
    settled.getSnapshot,
  );

  const formatOnSave = useSetting(preferences.fileFormatOnSave);
  const saveFile = useSaveDocument();

  const formatInProject = async (): Promise<string | null> =>
    workspace === undefined || project === undefined
      ? null
      : formatDocument({ view: viewKey, workspace: project, path: file.path, buffer });

  const save = async (): Promise<void> => {
    await buffer.save({
      write: (input) => saveFile.mutateAsync({ ...input, expect: input.version }),
      format: formatOnSave
        ? async () => {
            await formatInProject();

            return null;
          }
        : undefined,
    });
  };

  const latestSave = useRef(save);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest save for the autosave timer, which runs outside render
  useLayoutEffect(() => {
    latestSave.current = save;
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- buffer subscription that mirrors drafts into the file store
  useLayoutEffect(
    () =>
      mirrorDraft({ buffer, viewKey, path: file.path, autoSave, save: () => latestSave.current() }),
    [autoSave, buffer, file.path, viewKey],
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- shares the buffer with the other windows that have this file open
  useLayoutEffect(() => shareDocument(file.path, buffer), [buffer, file.path]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- hands the disk document to the buffer to detect outside edits
  useLayoutEffect(() => {
    buffer.observeDisk(document);
  }, [buffer, document]);

  const discard = async (): Promise<void> => {
    if (buffer.getSnapshot().status.kind === "saving") {
      throw new Error("Wait for the current save to finish.");
    }
    const result = await reload();

    if (result.error !== null) throw result.error;

    if (result.data?.kind !== "text") throw new Error("The file can no longer be read as text.");
    buffer.discard(result.data);
  };

  const commands: FileEditorHandle = {
    save,
    discard,
    format: (): Promise<void> => buffer.format(formatInProject),
  };

  useImperativeHandle(input.ref, () => commands);

  return { buffer, snapshot, settledText, commands };
}
