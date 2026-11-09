import { DEFAULT_CODE_VIEW_LAYOUT } from "@nyte-ai/ui/diffs";
import { Editor, resolveSearchShortcut } from "@nyte-ai/ui/diffs/edit";
import type { EditorOptions, EditorSelection, EditorType } from "@nyte-ai/ui/diffs/edit";
import type { CodeViewSearch, PostRenderPhase } from "@nyte-ai/ui/diffs";
import { CodeView, EditProvider } from "@nyte-ai/ui/diffs/react";
import type { CodeViewHandle, CodeViewItem } from "@nyte-ai/ui/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MouseEvent, ReactElement, Ref } from "react";
import type { Document } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import type { ThemePreference } from "../../contract/bridge.ts";
import { diffStyles } from "../../diff/diff.stylex.ts";
import { applyDiffScopes } from "../../diff/diff-view.tsx";
import { revealLabel, showContextMenu } from "../../components/context-menu.ts";
import { nyte } from "../../contract/nyte.ts";
import { addFileToChat, addsToChat } from "../../references/add-to-chat.ts";
import {
  SELECTION_ACTION_CSS,
  selectedLines,
  selectionAction,
  wholeLineSelection,
} from "./editor-selection.ts";
import { ChangePeek, useLineChanges } from "./change-peek.tsx";
import { revertChange } from "./line-changes.ts";
import {
  PIERRE_HIGHLIGHTER_OPTIONS,
  PIERRE_TOKEN_CSS,
  PierreWorkerProvider,
} from "@nyte-ai/ui/worker-pool";
import { keys } from "../../data/query-client.ts";
import { loadDeferred, readDeferred } from "../../lib/deferred.tsx";
import type { DeferredRuntimes } from "../../lib/deferred-entries.ts";
import { documentsApi, useDocument, useSaveDocument } from "../../data/documents.ts";
import { filesFor } from "../../data/files.ts";
import { formatBytes } from "../../lib/format.ts";
import { gitFor } from "../../data/vcs.ts";
import { preferences, useSetting } from "../../preferences/index.ts";
import { useAppearance } from "../../theme/appearance-store.ts";
import { watchFamily } from "../../data/watch-store.ts";
import { EditorFind } from "./editor-find.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import type { WorkbenchViewKey } from "../model.ts";
import { workspaceFile } from "../paths.ts";
import { useWorkbenchWorkspace } from "../workbench-workspace.tsx";
import { createFileDocument } from "./file-document.ts";
import { FileImage, FileMessage, FileVideo, RevealButton, viewerStyles } from "./file-viewers.tsx";
import type { SizedFile } from "./file-viewers.tsx";
import { fileActions } from "./file-store.ts";
import { MarkdownDocument } from "./markdown-document.tsx";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { pdfQuery } from "./pdf-query.ts";
import type { FileTab } from "./file-store.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

interface Caret {
  readonly revision: number;
  readonly line?: number;
  readonly column?: number;
  readonly lines?: { readonly start: number; readonly end: number };
}

const diskEvents = watchFamily((connection, path: string) => connection.documents.watch([path]));

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
  readonly onGoToLine: () => void;
}

const EDITOR_CSS = `
${PIERRE_TOKEN_CSS}
:host {
  color-scheme: inherit;
  --diffs-bg: ${role.bgBase};
}
${SELECTION_ACTION_CSS}
`;

const EDITOR_LAYOUT = { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 };

export function editorViewOptions(input: {
  readonly theme: ThemePreference;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
}) {
  return {
    ...PIERRE_HIGHLIGHTER_OPTIONS,
    themeType: input.theme,
    unsafeCSS: EDITOR_CSS,
    disableFileHeader: true,
    layout: EDITOR_LAYOUT,
    disableLineNumbers: !input.lineNumbers,
    overflow: input.wordWrap ? ("wrap" as const) : ("scroll" as const),
    onPostRender: colorChanges,
    searchOptions: { disableShortcuts: true },
  };
}

function colorChanges(...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void {
  if (phase !== "unmount") applyDiffScopes(node);
}

export function createEditor<EType extends EditorType>(
  editorType: EType,
  options: EditorOptions<EType, undefined, undefined>,
  editStateKey?: string,
): Editor<EType, undefined, undefined> {
  return new Editor(editorType, options, editStateKey);
}

export const styles = create({
  code: {
    "--diffs-min-number-column-width": "initial",
    overflow: "auto",
    flex: 1,
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  error: { color: role.contentSecondary },
  saveText: { flex: "0 1 auto" },
  position: { flexShrink: 0, marginInlineStart: "auto", color: role.contentSecondary },
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
    const queryKey = keys.document(path);
    const events = diskEvents(path);

    const read = () =>
      void queryClient.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false });

    read();

    return events.subscribe(() => {
      const shown = queryClient.getQueryData<Document>(queryKey);
      const event = events.value?.at(-1);

      if (
        event !== undefined &&
        shown !== undefined &&
        "version" in shown &&
        shown.version === event.version
      )
        return;

      read();
    });
  });

  return null;
}

export function WorkspaceFileEditor(input: FileEditorProps): ReactElement {
  const document = useDocument(input.file.path);

  return (
    <>
      <DiskSync key={input.file.path} path={input.file.path} />
      <FileView {...input} document={document} />
    </>
  );
}

function FileView(
  input: FileEditorProps & { readonly document: ReturnType<typeof useDocument> },
): ReactElement {
  const query = input.document;
  const retry = <Button onClick={() => void query.refetch()}>Retry</Button>;

  if (query.data === undefined)
    return query.isError ? (
      <FileMessage active={input.active} alert title="The file could not be opened.">
        <span {...props(viewerStyles.messageDetail)}>{query.error.message}</span>
        {retry}
      </FileMessage>
    ) : (
      <FileMessage active={input.active} title="Opening file…" />
    );
  const document = query.data;
  const reveal = <RevealButton path={document.path} />;

  switch (document.kind) {
    case "text":
      return <TextFileEditor {...input} document={document} reload={query.refetch} />;
    case "image":
      return <FileImage key={document.version} active={input.active} document={document} />;
    case "video":
      return <FileVideo key={document.version} active={input.active} document={document} />;
    case "pdf":
      return <FilePdf active={input.active} document={document} />;
    case "binary":
      return (
        <FileMessage active={input.active} title="This file can't be shown here.">
          <span>Binary · {formatBytes(document.size)}</span>
          {reveal}
        </FileMessage>
      );
    case "large":
      return (
        <FileMessage active={input.active} title="This file is too large to open here.">
          <span>{formatBytes(document.size)}. The editor opens text files up to 1 MB.</span>
          {reveal}
        </FileMessage>
      );
    case "missing":
      return (
        <FileMessage active={input.active} title="This file isn't on disk.">
          <span {...props(viewerStyles.messageDetail)}>{document.path}</span>
          {retry}
        </FileMessage>
      );
    case "directory":
      return (
        <FileMessage active={input.active} title="This is a folder.">
          <span {...props(viewerStyles.messageDetail)}>{document.path}</span>
          {reveal}
        </FileMessage>
      );
    default: {
      const exhaustive: never = document;

      return exhaustive;
    }
  }
}

function FilePdf(input: { readonly active: boolean; readonly document: SizedFile }): ReactElement {
  const [runtime, setRuntime] = useState<DeferredRuntimes["pdf"] | "failed" | undefined>(() =>
    readDeferred("pdf"),
  );

  useMountEffect(() => {
    if (runtime === undefined)
      void loadDeferred("pdf").then(setRuntime, () => setRuntime("failed"));
  });

  if (runtime === "failed")
    return (
      <FileMessage active={input.active} title="PDFs can't be previewed here.">
        <span>PDF · {formatBytes(input.document.size)}</span>
        <RevealButton path={input.document.path} />
      </FileMessage>
    );

  if (runtime === undefined) return <FileMessage active={input.active} title="Opening file…" />;

  return <PdfDocument {...input} runtime={runtime} />;
}

function PdfDocument(input: {
  readonly active: boolean;
  readonly document: SizedFile;
  readonly runtime: DeferredRuntimes["pdf"];
}): ReactElement {
  const path = input.document.path;
  const runtime = input.runtime;

  const pdf = useQuery(
    pdfQuery(
      path,
      input.document.version,
      async () => (await documentsApi()).bytes(path),
      runtime.openPdf,
    ),
  );

  if (pdf.data === undefined) {
    if (!pdf.isError) return <FileMessage active={input.active} title="Opening file…" />;

    return (
      <FileMessage
        active={input.active}
        alert
        title={
          pdf.error.name === "PasswordException"
            ? "This PDF is password-protected."
            : "This PDF could not be opened."
        }
      >
        {pdf.error.name !== "PasswordException" && (
          <span {...props(viewerStyles.messageDetail)}>{pdf.error.message}</span>
        )}
        <RevealButton path={path} />
      </FileMessage>
    );
  }

  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(viewerStyles.root, !input.active && viewerStyles.hidden)}
    >
      <runtime.PdfViewer
        file={pdf.isPlaceholderData ? undefined : pdf.data}
        label={path.split("/").at(-1) ?? path}
      />
    </div>
  );
}

export function TextFileEditor({
  ref,
  viewKey,
  file,
  active,
  autoSave,
  onGoToLine,
  document,
  reload,
}: FileEditorProps & {
  readonly document: TextFile;
  readonly reload: ReturnType<typeof useDocument>["refetch"];
}): ReactElement {
  const { navigationRevision } = file;

  const [buffer] = useState(() =>
    fileActions.buffer(viewKey, file.path, () => createFileDocument(document)),
  );

  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, buffer.getSnapshot);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [search, setSearch] = useState<CodeViewSearch>();
  const mac = nyte.platform === "darwin";

  const navigation = useRef({ active, revision: navigationRevision, target: file.target });

  const appliedNavigation = useRef(-1);

  const [caret, setCaret] = useState<Caret>({ revision: navigationRevision });

  if (caret.revision !== navigationRevision) setCaret({ revision: navigationRevision });
  const target = file.target;

  const line = caret.line ?? (target?.kind === "lines" ? target.lines.start : target?.line) ?? 1;

  const column = caret.column ?? (target?.kind === "lines" ? 1 : target?.column) ?? 1;

  const showCaret = (selection: EditorSelection | undefined): void => {
    if (selection === undefined) return;
    const focus = selection.direction === -1 ? selection.start : selection.end;

    setCaret({
      revision: navigation.current.revision,
      line: focus.line + 1,
      column: focus.character + 1,
      lines: selectedLines(selection),
    });
  };

  const readCaret = (): void =>
    showCaret(viewer.current?.getEditor(file.path)?.getViewState().selections?.[0]);

  const addSelection = (selection: EditorSelection | undefined): boolean => {
    const lines = selectedLines(selection);

    return lines !== undefined && addFileToChat(file, lines);
  };

  const theme = useAppearance().theme;
  const codeFont = useSetting(preferences.codeFont);
  const codeFontSize = useSetting(preferences.codeFontSize);
  const lineNumbers = useSetting(preferences.fileLineNumbers);
  const wordWrap = useSetting(preferences.fileWordWrap);
  const documentView = opensAsMarkdown(file.path) && !file.showSource;
  const browsed = useWorkbenchWorkspace();

  const workspace =
    browsed.kind === "ready" && workspaceFile(file.path, [browsed.workspace.path]) !== undefined
      ? browsed.workspace.id
      : undefined;

  const gitBlame = useSetting(preferences.fileGitBlame) && workspace !== undefined && !documentView;
  const formatOnSave = useSetting(preferences.fileFormatOnSave);
  const saveFile = useSaveDocument();
  const dirty = snapshot.contents !== snapshot.savedContents;

  const changeTracking = useLineChanges({
    workspace,
    path: file.path,
    relative: file.displayPath,
    contents: snapshot.contents,
    enabled: active && !documentView,
    line,
    reveal: (lineNumber) =>
      viewer.current?.scrollTo({ type: "line", id: file.path, lineNumber, align: "center" }),
    viewer,
  });

  const latestPeekAt = useRef(changeTracking.peekAt);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest peek for gutter clicks, which keeps the viewer's options stable
  useLayoutEffect(() => {
    latestPeekAt.current = changeTracking.peekAt;
  });

  const viewOptions = {
    ...editorViewOptions({ theme, lineNumbers, wordWrap }),
    unsafeCSS: `${EDITOR_CSS}\n${changeTracking.css}`,
    onLineNumberClick: (event: { readonly lineNumber: number }) =>
      latestPeekAt.current(event.lineNumber),
  };

  const blame = useQuery({
    queryKey: ["files", "blame", file.path, snapshot.version],
    queryFn: async () => (await gitFor(workspace)).blame(file.path),
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

  const save = async (): Promise<void> => {
    await buffer.save({
      write: (input) =>
        saveFile.mutateAsync({ path: input.path, contents: input.contents, expect: input.version }),
      format:
        formatOnSave && workspace !== undefined
          ? async (input) => (await filesFor(workspace)).format(input.path, input.contents)
          : undefined,
    });
  };

  const latestSave = useRef(save);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest save for the autosave timer, which runs outside render
  useLayoutEffect(() => {
    latestSave.current = save;
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- buffer subscription that mirrors drafts into the file store
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
        autoSave &&
        current.contents !== current.savedContents &&
        (current.status.kind === "idle" || current.status.kind === "saved")
      ) {
        timer = window.setTimeout(() => {
          timer = undefined;
          void latestSave.current();
        }, 1000);
      }
    };

    synchronize();
    const unsubscribe = buffer.subscribe(synchronize);

    return () => {
      unsubscribe();

      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [autoSave, buffer, file.path, viewKey]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- hands the disk document to the buffer to detect outside edits
  useLayoutEffect(() => {
    buffer.observeDisk(document);
  }, [buffer, document]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- re-renders the imperative viewer when the code font changes
  useLayoutEffect(() => {
    viewer.current?.getInstance()?.render(true);
  }, [codeFont, codeFontSize]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- writes buffer contents into the imperative editor before paint
  useLayoutEffect(() => {
    const editor = viewer.current?.getEditor(file.path);

    if (editor !== undefined) replaceContents(editor, snapshot.contents);
  }, [file.path, snapshot.contents]);

  const showTarget = (
    editor: Pick<Editor, "focus" | "getText" | "getViewState" | "setSelections">,
  ): void => {
    const request = navigation.current;
    const shown = request.target;

    if (!request.active || shown === undefined || appliedNavigation.current >= request.revision)
      return;
    appliedNavigation.current = request.revision;
    const range = shown.kind === "lines" ? shown.lines : { start: shown.line, end: shown.line };
    viewer.current?.scrollTo({
      type: "line",
      id: file.path,
      lineNumber: range.start,
      align: "center",
    });
    viewer.current?.setSelectedLines({ id: file.path, range });
    editor.focus({
      lineNumber: range.start,
      character: shown.kind === "lines" ? 0 : (shown.column ?? 1) - 1,
      preventScroll: true,
    });

    if (shown.kind === "match")
      editor.setSelections([
        {
          start: { line: shown.line - 1, character: shown.column - 1 },
          end: { line: shown.line - 1, character: shown.column - 1 + shown.length },
          direction: "forward",
        },
      ]);

    if (shown.kind !== "lines") return;
    editor.setSelections([wholeLineSelection(editor.getText(), shown.lines)]);
    showCaret(editor.getViewState().selections?.[0]);
  };

  const attachEditor = (
    editor: Pick<
      Editor,
      "getFile" | "getText" | "getViewState" | "applyEdits" | "focus" | "setSelections"
    >,
  ): void => {
    if (editor.getFile() === undefined) return;
    replaceContents(editor, buffer.getSnapshot().contents);
    showTarget(editor);
  };

  const attachCurrentEditor = useEffectEvent(attachEditor);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- applies line navigation to the imperative editor before paint
  useLayoutEffect(() => {
    navigation.current = { active, revision: navigationRevision, target: file.target };
    const editor = viewer.current?.getEditor(file.path);

    if (editor !== undefined) attachCurrentEditor(editor);
  }, [active, file.path, file.target, navigationRevision]);

  const discard = async (): Promise<void> => {
    if (buffer.getSnapshot().status.kind === "saving")
      throw new Error("Wait for the current save to finish.");
    const result = await reload();

    if (result.error !== null) throw result.error;

    if (result.data?.kind !== "text") throw new Error("The file can no longer be read as text.");
    buffer.discard(result.data);
  };

  const format = async (): Promise<void> => {
    if (workspace === undefined) return;
    const current = buffer.getSnapshot();

    const result = await (await filesFor(workspace)).format(file.path, current.contents);

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
            caret.lines !== undefined && {
              kind: "item",
              label: "Add Selection to Chat",
              accelerator: "CmdOrCtrl+Shift+L",
              run: () => {
                const lines = caret.lines;

                if (lines !== undefined) addFileToChat(file, lines);
              },
            },
            { kind: "item", label: "Add File to Chat", run: () => addFileToChat(file) },
            { kind: "separator" },
            workspace !== undefined && {
              kind: "item",
              label: "Format Document",
              run: () => void format(),
            },
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
            !file.external && {
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

  const saveText =
    snapshot.status.kind === "saving" ? "Saving…" : snapshot.status.kind === "saved" ? "Saved" : "";

  const errorText =
    snapshot.status.kind === "conflict"
      ? "This file changed on disk. Your draft is preserved. Discard changes to reload the disk version."
      : snapshot.status.kind === "error"
        ? snapshot.status.message
        : "";

  const statusVisible = !documentView || gitBlame || saveText !== "" || errorText !== "";

  const position =
    caret.lines === undefined || caret.lines.start === caret.lines.end
      ? `Ln ${String(line)}, Col ${String(column)}`
      : `${String(caret.lines.end - caret.lines.start + 1)} lines selected`;

  return (
    <div
      aria-hidden={!active}
      inert={!active}
      onContextMenu={openContextMenu}
      onKeyUp={readCaret}
      onPointerUp={readCaret}
      onKeyDown={(event) => {
        const shortcut = resolveSearchShortcut(event.nativeEvent, mac);

        if (!documentView && (shortcut === "find" || shortcut === "replace")) {
          const next = viewer.current
            ?.getInstance()
            ?.openHeadlessSearch({ scope: { itemId: file.path }, mode: shortcut });

          if (next === undefined) return;
          event.preventDefault();
          setSearch(next);

          return;
        }

        if (event.key === "F3" && event.altKey && !documentView) {
          event.preventDefault();
          changeTracking.step(event.shiftKey ? -1 : 1);

          return;
        }

        if (event.defaultPrevented || !addsToChat(event.nativeEvent, mac)) return;

        if (addSelection(viewer.current?.getEditor(file.path)?.getViewState().selections?.[0]))
          event.preventDefault();
      }}
      {...props(viewerStyles.root, !active && viewerStyles.hidden)}
    >
      {documentView ? (
        <MarkdownDocument
          buffer={buffer}
          path={file.path}
          label={file.displayPath}
          viewKey={viewKey}
        />
      ) : (
        <>
          <PierreWorkerProvider>
            <EditProvider createEditor={createEditor}>
              <CodeView
                ref={viewer}
                initialItems={initialItems}
                editorOptions={{
                  historyMaxEntries: 200,
                  ownsVerticalViewport: true,
                  onAttach: attachEditor,
                  enabledSelectionAction: true,
                  renderSelectionAction: (context) =>
                    selectionAction(mac, () => {
                      if (addSelection(context.selection)) context.close();
                    }),
                }}
                options={viewOptions}
                className={props(diffStyles.patch, styles.code).className}
                onItemEditChange={(event) => buffer.edit(event.file.contents)}
                renderAnnotation={() =>
                  changeTracking.peek !== undefined && (
                    <ChangePeek
                      {...changeTracking.peek}
                      onStep={changeTracking.step}
                      onRevert={() => {
                        const change = changeTracking.peek?.change;

                        if (change !== undefined)
                          buffer.edit(revertChange(buffer.getSnapshot().contents, change));
                        changeTracking.close();
                      }}
                      onClose={changeTracking.close}
                    />
                  )
                }
              />
            </EditProvider>
          </PierreWorkerProvider>
          <EditorFind
            search={search}
            onClose={() => {
              search?.close();
              setSearch(undefined);
              viewer.current?.getEditor(file.path)?.focus();
            }}
          />
        </>
      )}
      <div
        {...props(statusVisible ? viewerStyles.status : srOnly)}
        title={gitBlame ? blameText : undefined}
      >
        {gitBlame && <span {...props(viewerStyles.statusText)}>{blameText}</span>}
        <span role="status" {...props(viewerStyles.statusText, styles.saveText)}>
          {saveText}
        </span>
        <span
          role="alert"
          {...props(intent.danger, styles.error, viewerStyles.statusText, styles.saveText)}
        >
          {errorText}
        </span>
        {snapshot.status.kind === "error" && (
          <Button onClick={() => void save()}>Retry Save</Button>
        )}
        {!documentView && (
          <span {...props(styles.position)}>
            <Button
              size="2xs"
              variant="plain"
              title={`Go to Line (${mac ? "⌃G" : "Ctrl+G"})`}
              onClick={onGoToLine}
            >
              {position}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
