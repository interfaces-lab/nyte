import { DEFAULT_CODE_VIEW_LAYOUT } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import type { EditorOptions, EditorSearch, EditorType } from "@pierre/diffs/edit";
import { CodeView, EditProvider } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MouseEvent, ReactElement, Ref } from "react";
import type { FileDocument, FileEvent } from "@nyte-ai/sdk";
import { button, space } from "@nyte-ai/ui/styles/schema.stylex";
import { Button } from "@nyte-ai/ui/button";
import { diffStyles } from "../conversation/diff.stylex.ts";
import { revealLabel, showContextMenu } from "../components/context-menu.ts";
import { nyte } from "../nyte.ts";
import {
  PIERRE_HIGHLIGHTER_OPTIONS,
  PIERRE_TOKEN_CSS,
  PierreWorkerProvider,
} from "../pierre-worker-provider.tsx";
import {
  keys,
  useSaveWorkspaceFile,
  useWorkspaceFile,
  workspaceFiles,
  workspaceGit,
} from "../queries.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { watchFamily } from "../sdk.tsx";
import { FindWidget } from "./find-widget.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { WorkbenchViewKey } from "./controller.ts";
import { createFileDocument } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";

type TextFile = Extract<FileDocument, { readonly kind: "text" }>;

const diskEvents = watchFamily((_connection, path: string): AsyncIterable<readonly FileEvent[]> =>
  (async function* () {
    yield* (await workspaceFiles()).watch({ paths: [path] });
  })(),
);

export interface FileEditorHandle {
  save(): Promise<void>;
  discard(): Promise<void>;
  format(): Promise<void>;
}

interface FileEditorProps {
  readonly ref?: Ref<FileEditorHandle>;
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly active: boolean;
  readonly autoSave: boolean;
}

const EDITOR_CSS = `
${PIERRE_TOKEN_CSS}
:host {
  color-scheme: inherit;
  --diffs-bg: ${role.bgBase};
}
[data-column-number] {
  padding-left: 1ch;
}
[data-column-number][data-editor-active-line] {
  --diffs-computed-editor-active-line-bg: var(--diffs-computed-selected-line-bg);
  color: var(--diffs-fg-number);
}
`;

const EDITOR_LAYOUT = { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 };

function createEditor<EType extends EditorType>(
  editorType: EType,
  options: EditorOptions<EType, undefined, undefined>,
  editStateKey?: string,
): Editor<EType, undefined, undefined> {
  return new Editor(editorType, options, editStateKey);
}

const styles = create({
  root: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  hidden: { visibility: "hidden", pointerEvents: "none" },
  code: {
    "--diffs-min-number-column-width": "initial",
    overflow: "auto",
    flex: 1,
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  message: {
    padding: space.s5,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    minHeight: button.heightMd,
    paddingInline: space.s2_5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    backgroundColor: role.bgBase,
  },
  error: { color: role.contentSecondary },
  saveText: { flex: "0 1 auto" },
  statusText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function replaceContents(
  editor: Pick<Editor, "getFile" | "getText" | "applyEdits">,
  contents: string,
): void {
  if (editor.getFile() === undefined) return;
  const previous = editor.getText();

  if (previous === contents) return;
  let start = 0;

  while (start < previous.length && start < contents.length && previous[start] === contents[start])
    start += 1;
  let end = previous.length;
  let nextEnd = contents.length;

  while (end > start && nextEnd > start && previous[end - 1] === contents[nextEnd - 1]) {
    end -= 1;
    nextEnd -= 1;
  }

  if (start > 0 && previous[start - 1] === "\r" && previous[start] === "\n") start -= 1;

  if (end > 0 && previous[end - 1] === "\r" && previous[end] === "\n") {
    end += 1;
    nextEnd += 1;
  }

  const before = previous.slice(0, start).split("\n");
  const through = previous.slice(0, end).split("\n");
  editor.applyEdits([
    {
      range: {
        start: { line: before.length - 1, character: before.at(-1)?.length ?? 0 },
        end: { line: through.length - 1, character: through.at(-1)?.length ?? 0 },
      },
      newText: contents.slice(start, nextEnd),
    },
  ]);
}

function DiskSync({ path }: { readonly path: string }): null {
  const queryClient = useQueryClient();

  useMountEffect(() => {
    const queryKey = keys.workspaceFile(path);
    void queryClient.refetchQueries({ queryKey, exact: true, stale: true });

    return diskEvents(path).subscribe(
      () => void queryClient.refetchQueries({ queryKey, exact: true }),
    );
  });

  return null;
}

export function WorkspaceFileEditor(input: FileEditorProps): ReactElement {
  const document = useWorkspaceFile(input.file.path);

  if (document.data?.kind === "text")
    return <TextFileEditor {...input} document={document.data} reload={document.refetch} />;

  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(styles.root, !input.active && styles.hidden)}
    >
      <div role={document.isError ? "alert" : "status"} {...props(text.sm, styles.message)}>
        {document.isError
          ? `The file could not be opened. ${document.error.message}`
          : document.data?.kind === "binary"
            ? "Binary files cannot be edited here."
            : document.data?.kind === "large"
              ? "This file is too large for the workbench editor."
              : "Opening file…"}
      </div>
    </div>
  );
}

export function TextFileEditor({
  ref,
  viewKey,
  file,
  active,
  autoSave,
  document,
  reload,
}: FileEditorProps & {
  readonly document: TextFile;
  readonly reload: ReturnType<typeof useWorkspaceFile>["refetch"];
}): ReactElement {
  const { navigationRevision } = file;

  const [buffer] = useState(() =>
    createFileDocument(
      file.draft === undefined
        ? document
        : {
            ...document,
            contents: file.draft.savedContents,
            version: file.draft.version,
          },
      file.draft?.contents,
    ),
  );

  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, buffer.getSnapshot);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [search, setSearch] = useState<EditorSearch>();

  const navigation = useRef({
    active,
    revision: navigationRevision,
    line: file.line,
    column: file.column,
    length: file.length,
  });

  const appliedNavigation = useRef(-1);

  const [clicked, setClicked] = useState<{
    readonly line: number | undefined;
    readonly revision: number;
  }>({ line: undefined, revision: navigationRevision });

  if (clicked.revision !== navigationRevision)
    setClicked({ line: undefined, revision: navigationRevision });
  const line = clicked.line ?? file.line ?? 1;

  const theme = useSetting(preferences.theme);
  const codeFont = useSetting(preferences.codeFont);
  const codeFontSize = useSetting(preferences.codeFontSize);
  const lineNumbers = useSetting(preferences.fileLineNumbers);
  const wordWrap = useSetting(preferences.fileWordWrap);
  const gitBlame = useSetting(preferences.fileGitBlame);
  const formatOnSave = useSetting(preferences.fileFormatOnSave);
  const saveFile = useSaveWorkspaceFile();
  const dirty = snapshot.contents !== snapshot.savedContents;

  const viewOptions = useMemo(
    () => ({
      ...PIERRE_HIGHLIGHTER_OPTIONS,
      themeType: theme,
      unsafeCSS: EDITOR_CSS,
      disableFileHeader: true,
      layout: EDITOR_LAYOUT,
      disableLineNumbers: !lineNumbers,
      overflow: wordWrap ? ("wrap" as const) : ("scroll" as const),
      onLineClick: (event: { readonly lineNumber: number }) =>
        setClicked((current) => ({ ...current, line: event.lineNumber })),
    }),
    [lineNumbers, theme, wordWrap],
  );

  const blame = useQuery({
    queryKey: ["files", "blame", file.path, snapshot.version],
    queryFn: async () => (await workspaceGit()).blame(file.path),
    enabled: gitBlame && active && !dirty,
  });

  const [initialItems] = useState<readonly CodeViewItem<undefined>[]>(() => [
    {
      id: file.path,
      type: "file",
      edit: true,
      file: {
        name: file.displayPath,
        contents: buffer.getSnapshot().contents,
        cacheKey: file.path,
      },
    },
  ]);

  const save = (): Promise<void> =>
    buffer.save({
      write: (input) =>
        saveFile.mutateAsync({ path: input.path, contents: input.contents, expect: input.version }),
      format: formatOnSave
        ? async (input) => (await workspaceFiles()).format(input.path, input.contents)
        : undefined,
    });

  const autosave = useRef({ enabled: autoSave, save });
  useLayoutEffect(() => {
    autosave.current = { enabled: autoSave, save };
  });

  useLayoutEffect(() => {
    let timer: number | undefined;

    const synchronize = (): void => {
      const current = buffer.getSnapshot();
      fileActions.setSaving(viewKey, file.path, current.status.kind === "saving");
      fileActions.setDraft(
        viewKey,
        file.path,
        current.contents === current.savedContents
          ? undefined
          : {
              contents: current.contents,
              savedContents: current.savedContents,
              version: current.version,
            },
      );

      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }

      if (
        current.contents !== current.savedContents &&
        (current.status.kind === "idle" || current.status.kind === "saved")
      ) {
        timer = window.setTimeout(() => {
          timer = undefined;
          const pending = autosave.current;

          if (pending.enabled) void pending.save();
        }, 1000);
      }
    };

    synchronize();
    const unsubscribe = buffer.subscribe(synchronize);

    return () => {
      unsubscribe();

      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [buffer, file.path, viewKey]);

  useLayoutEffect(() => {
    buffer.observeDisk(document);
  }, [buffer, document]);

  useLayoutEffect(() => {
    viewer.current?.getInstance()?.render(true);
  }, [codeFont, codeFontSize]);

  useLayoutEffect(() => {
    const editor = viewer.current?.getEditor(file.path);

    if (editor !== undefined) replaceContents(editor, snapshot.contents);
  }, [file.path, snapshot.contents]);

  const attachEditor = useCallback(
    (
      editor: Pick<Editor, "getFile" | "getText" | "applyEdits" | "focus" | "setSelections">,
    ): void => {
      if (editor.getFile() === undefined) return;
      replaceContents(editor, buffer.getSnapshot().contents);
      const target = navigation.current;

      if (
        !target.active ||
        target.line === undefined ||
        appliedNavigation.current >= target.revision
      )
        return;
      appliedNavigation.current = target.revision;
      viewer.current?.scrollTo({
        type: "line",
        id: file.path,
        lineNumber: target.line,
        align: "center",
      });
      viewer.current?.setSelectedLines({
        id: file.path,
        range: { start: target.line, end: target.line },
      });
      editor.focus({
        lineNumber: target.line,
        character: (target.column ?? 1) - 1,
        preventScroll: true,
      });

      if (target.column !== undefined && target.length !== undefined)
        editor.setSelections([
          {
            start: { line: target.line - 1, character: target.column - 1 },
            end: { line: target.line - 1, character: target.column - 1 + target.length },
            direction: "forward",
          },
        ]);
    },
    [buffer, file.path],
  );

  useLayoutEffect(() => {
    navigation.current = {
      active,
      revision: navigationRevision,
      line: file.line,
      column: file.column,
      length: file.length,
    };
    const editor = viewer.current?.getEditor(file.path);

    if (editor !== undefined) attachEditor(editor);
  }, [active, attachEditor, file.column, file.length, file.line, file.path, navigationRevision]);

  const discard = async (): Promise<void> => {
    if (buffer.getSnapshot().status.kind === "saving")
      throw new Error("Wait for the current save to finish.");
    const result = await reload();

    if (result.error !== null) throw result.error;

    if (result.data?.kind !== "text") throw new Error("The file can no longer be read as text.");
    buffer.discard(result.data);
  };

  const format = async (): Promise<void> => {
    const current = buffer.getSnapshot();

    const result = await (await workspaceFiles()).format(file.path, current.contents);

    if (result.kind === "formatted") buffer.edit(result.contents);
  };

  useImperativeHandle(ref, () => ({ save, discard, format }));

  const contextMenu = nyte.host.contextMenu;
  const revealPath = nyte.host.revealPath;

  const openContextMenu =
    contextMenu === undefined
      ? undefined
      : (event: MouseEvent<HTMLElement>): void => {
          event.preventDefault();
          void showContextMenu(contextMenu, event, [
            { kind: "role", role: "cut", label: "Cut" },
            { kind: "role", role: "copy", label: "Copy" },
            { kind: "role", role: "paste", label: "Paste" },
            { kind: "role", role: "selectAll", label: "Select All" },
            { kind: "separator" },
            { kind: "item", label: "Format Document", run: () => void format() },
            {
              kind: "item",
              label: "Save",
              accelerator: "CmdOrCtrl+S",
              enabled: dirty,
              run: () => void save(),
            },
            { kind: "separator" },
            {
              kind: "item",
              label: "Copy Path",
              run: () => void navigator.clipboard.writeText(file.path),
            },
            {
              kind: "item",
              label: "Copy Relative Path",
              run: () => void navigator.clipboard.writeText(file.displayPath),
            },
            revealPath !== undefined && {
              kind: "item",
              label: revealLabel(nyte.platform),
              run: () => void revealPath({ path: file.path }),
            },
          ]);
        };

  const blameLine = blame.data?.lines.find((entry) => entry.line === line);

  const blameText = dirty
    ? "Save the file to see up-to-date Git blame."
    : blame.isError
      ? blame.error.message
      : blame.isFetching
        ? "Loading Git blame…"
        : blameLine === undefined
          ? "No Git blame for this line."
          : `${blameLine.author} · ${new Date(blameLine.at).toLocaleDateString()} · ${blameLine.commit.slice(0, 7)}`;

  return (
    <div
      aria-hidden={!active}
      inert={!active}
      onContextMenu={openContextMenu}
      {...props(styles.root, !active && styles.hidden)}
    >
      {active && <DiskSync key={file.path} path={file.path} />}
      <PierreWorkerProvider>
        <EditProvider createEditor={createEditor}>
          <CodeView
            ref={viewer}
            initialItems={initialItems}
            editorOptions={{
              historyMaxEntries: 200,
              ownsVerticalViewport: true,
              onAttach: attachEditor,
              onSearchChange: setSearch,
            }}
            options={viewOptions}
            className={props(diffStyles.patch, styles.code).className}
            onItemEditChange={(event) => buffer.edit(event.file.contents)}
          />
        </EditProvider>
      </PierreWorkerProvider>
      {search !== undefined && (
        <EditorFind
          search={search}
          onClose={() => {
            search.close();
            viewer.current?.getEditor(file.path)?.focus();
          }}
        />
      )}
      <div {...props(styles.status)} title={gitBlame ? blameText : undefined}>
        {gitBlame && (
          <>
            <span>Line {line}</span>
            <span {...props(styles.statusText)}>{blameText}</span>
          </>
        )}
        <span role="status" {...props(styles.statusText, styles.saveText)}>
          {snapshot.status.kind === "saving"
            ? "Saving…"
            : snapshot.status.kind === "saved"
              ? "Saved"
              : ""}
        </span>
        <span
          role="alert"
          {...props(intent.danger, styles.error, styles.statusText, styles.saveText)}
        >
          {snapshot.status.kind === "conflict"
            ? "This file changed on disk. Your draft is preserved. Discard changes to reload the disk version."
            : snapshot.status.kind === "error"
              ? snapshot.status.message
              : ""}
        </span>
        {snapshot.status.kind === "error" && (
          <Button onClick={() => void save()}>Retry Save</Button>
        )}
      </div>
    </div>
  );
}

function EditorFind({
  search,
  onClose,
}: {
  readonly search: EditorSearch;
  readonly onClose: () => void;
}): ReactElement {
  const snapshot = useSyncExternalStore(search.subscribe, search.getSnapshot);

  return (
    <FindWidget
      label="Find in file"
      target={search}
      initialText={snapshot.defaultQuery}
      focusRevision={snapshot.openRevision}
      replace={{
        target: search,
        open: snapshot.mode === "replace",
        onOpenChange: (open) => search.setMode(open ? "replace" : "find"),
      }}
      onClose={onClose}
    />
  );
}
