import { DEFAULT_CODE_VIEW_LAYOUT } from "@nyte-ai/ui/diffs";
import { EditStateManager, Editor, resolveSearchShortcut } from "@nyte-ai/ui/diffs/edit";
import type { EditorSelection } from "@nyte-ai/ui/diffs/edit";
import type { CodeViewSearch, PostRenderPhase } from "@nyte-ai/ui/diffs";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
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
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { Document } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import type { ThemePreference } from "../../contract/bridge.ts";
import { diffStyles } from "../../diff/diff.stylex.ts";
import { applyDiffScopes } from "../../diff/diff-view.tsx";
import { revealLabel, showContextMenu } from "../../components/context-menu.ts";
import { nyte } from "../../contract/nyte.ts";
import { addFileToChat, addsToChat } from "../../references/add-to-chat.ts";
import {
  SELECTION_ACTION_CSS,
  selectedLines,
  revealSelection,
  shineSelection,
  wholeLineSelection,
} from "./editor-selection.ts";
import { ChangePeek, useLineChanges } from "./change-peek.tsx";
import { DeclarationPopups } from "./declaration-popups.tsx";
import { shareDocument } from "./document-channel.ts";
import { mirrorDraft } from "./draft-mirror.ts";
import { languageDocuments } from "./language-documents.ts";
import { caretPosition, editorRange, textChanges } from "./pierre-language.ts";
import { DECLARATION_LINK_CSS, useDeclarations } from "./use-declarations.ts";
import {
  BlameText,
  CaretPosition,
  caretStore,
  documentEditor,
  FileCodeView,
  itemEditorOptions,
  latestValue,
  shownCaret,
  viewerHandlers,
} from "./file-code-view.tsx";
import type { ItemEditor, ItemEditorCallbacks } from "./file-code-view.tsx";
import { changeBarCss, revertEdit } from "./line-changes.ts";
import type { LineChange } from "./line-changes.ts";
import { PIERRE_EDITOR_HIGHLIGHTER_OPTIONS, PIERRE_TOKEN_CSS } from "@nyte-ai/ui/worker-pool";
import { keys } from "../../data/query-client.ts";
import { loadDeferred, useDeferred } from "../../lib/deferred.tsx";
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
import {
  bufferState,
  createFileDocument,
  sameBufferState,
  settledContents,
} from "./file-document.ts";
import type { DocumentEditor, FileBuffer } from "./file-document.ts";
import { TAB_COLUMNS, visualColumn } from "./indentation.ts";
import { FileImage, FileMessage, FileVideo, RevealButton, viewerStyles } from "./file-viewers.tsx";
import type { SizedFile } from "./file-viewers.tsx";
import { fileActions, holdDocument } from "./file-store.ts";
import { MarkdownDocument } from "./markdown-document.tsx";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { pdfQuery } from "./pdf-query.ts";
import type { FileTab } from "./file-store.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

const SETTLE_MS = 250;

const diskEvents = watchFamily((connection, path: string) => ({
  values: connection.documents.watch([path]),
  ended: "reopen" as const,
}));

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
  /** Whether the tab is its group's shown one, so its editor is mounted; hidden tabs keep only their document. */
  readonly visible: boolean;
  readonly autoSave: boolean;
  readonly onGoToLine: () => void;
}

const EDITOR_CSS = `
${PIERRE_TOKEN_CSS}
:host {
  color-scheme: inherit;
  --diffs-bg: transparent;
}
${SELECTION_ACTION_CSS}
${DECLARATION_LINK_CSS}
`;

const EDITOR_LAYOUT = { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 };

const ITEM_METRICS = new Map<number, { readonly lineHeight: number }>();

function codeViewMetrics(codeFontSize: number) {
  const held = ITEM_METRICS.get(codeFontSize);

  if (held !== undefined) return held;
  const made = { lineHeight: Math.ceil((codeFontSize * 20) / 12) };
  ITEM_METRICS.set(codeFontSize, made);

  return made;
}

export function editorViewOptions(input: {
  readonly theme: ThemePreference;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  readonly codeFontSize: number;
}) {
  return {
    ...PIERRE_EDITOR_HIGHLIGHTER_OPTIONS,
    themeType: input.theme,
    unsafeCSS: EDITOR_CSS,
    disableFileHeader: true,
    layout: EDITOR_LAYOUT,
    itemMetrics: codeViewMetrics(input.codeFontSize),
    disableLineNumbers: !input.lineNumbers,
    overflow: input.wordWrap ? ("wrap" as const) : ("scroll" as const),
    onPostRender: colorChanges,
    searchOptions: { disableShortcuts: true },
    pointerEventsOnScroll: true,
  };
}

function colorChanges(...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void {
  if (phase !== "unmount") applyDiffScopes(node);
}

export const styles = create({
  code: {
    "--diffs-min-number-column-width": "initial",
    "--diffs-fg-number-override": "initial",
    overflow: "auto",
    flex: 1,
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  error: { color: role.contentSecondary },
  saveText: { flex: "0 1 auto" },
  position: {
    flexShrink: 0,
    marginInlineStart: "auto",
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  readOnly: { display: "flex", alignItems: "center", gap: space.s1, flexShrink: 0 },
});

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
          <span>{formatBytes(document.size)}. The editor opens text files up to 64 MB.</span>
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
  const runtime = useDeferred("pdf");

  useMountEffect(() => {
    void loadDeferred("pdf").catch(() => undefined);
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
  visible,
  autoSave,
  onGoToLine,
  document,
  reload,
}: FileEditorProps & {
  readonly document: TextFile;
  readonly reload: ReturnType<typeof useDocument>["refetch"];
}): ReactElement {
  const { navigationRevision } = file;

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

  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);

  const [setViewer] = useState(
    () =>
      (handle: CodeViewHandle<undefined, undefined> | null): void => {
        viewer.current = handle;
      },
  );
  const root = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<CodeViewSearch>();
  const mac = nyte.platform === "darwin";

  const navigation = useRef({ active, revision: navigationRevision, target: file.target });

  const appliedNavigation = useRef(-1);

  const [caret] = useState(caretStore);

  const scrollTop = useRef(0);

  const attached = useRef<{ readonly editor: ItemEditor; readonly source: DocumentEditor }>(
    undefined,
  );

  const editKey = `${viewKey}\n${file.id}`;

  const showCaret = (selection: EditorSelection | undefined): void => {
    if (selection === undefined) return;
    const focus = selection.direction === -1 ? selection.start : selection.end;
    const lineText = viewer.current?.getEditor(file.path)?.getLineText(focus.line);

    caret.set({
      revision: navigation.current.revision,
      line: focus.line + 1,
      column:
        lineText === undefined
          ? focus.character + 1
          : visualColumn(lineText, focus.character, TAB_COLUMNS) + 1,
      lines: selectedLines(selection),
    });
  };

  const selectionChanged = useRef((selections: readonly EditorSelection[]): void => {
    showCaret(selections.at(-1));
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest selection reader for Pierre's callback, which keeps the editor's options stable
  useLayoutEffect(() => {
    selectionChanged.current = (selections) => {
      const primary = selections.at(-1);
      const text = viewer.current?.getEditor(file.path)?.getEditState()?.document;

      showCaret(primary);

      if (
        primary !== undefined &&
        text !== undefined &&
        window.document.hasFocus() &&
        root.current?.contains(window.document.activeElement) === true
      )
        shineSelection(file.path, text, primary);
    };
  });

  const currentEditor = () => viewer.current?.getEditor(file.path);

  useMountEffect(() =>
    fileActions.track(file.id, () => {
      const view = currentEditor()?.getViewState();

      return view?.selections === undefined ? undefined : { kind: "view", view };
    }),
  );

  useMountEffect(() => () => {
    if (!fileActions.holds(viewKey, file.id)) EditStateManager.clear("file", editKey);
  });

  const addSelection = (selection: EditorSelection | undefined): boolean => {
    const lines = selectedLines(selection);

    return lines !== undefined && addFileToChat(file, lines);
  };

  const appearance = useAppearance();
  const theme = appearance.theme;
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

  const project = browsed.kind === "ready" ? browsed.workspace : undefined;

  useMountEffect(() => () => {
    if (project !== undefined) languageDocuments.closed(project.path, file.path);
  });

  const declarations = useDeclarations({
    viewKey,
    path: file.path,
    buffer,
    workspace: project,
    mac,
    caret: () => caretPosition(currentEditor()?.getViewState().selections?.at(-1)),
    rangeRect: (range) => currentEditor()?.getRangeRect(editorRange(range)),
    fallbackRect: () => root.current?.getBoundingClientRect() ?? new DOMRect(),
  });

  const gitBlame = useSetting(preferences.fileGitBlame) && workspace !== undefined && !documentView;
  const formatOnSave = useSetting(preferences.fileFormatOnSave);
  const saveFile = useSaveDocument();
  const dirty = snapshot.dirty;

  const changeTracking = useLineChanges({
    workspace,
    path: file.path,
    relative: file.displayPath,
    contents: settledText,
    saved: snapshot.savedContents,
    enabled: active && !documentView,
    caretLine: () => shownCaret(caret.get(), navigationRevision, file.target).line,
    reveal: (lineNumber) =>
      viewer.current?.scrollTo({ type: "line", id: file.path, lineNumber, align: "center" }),
    viewer,
  });

  const [latest] = useState(() =>
    latestValue({ peekAt: changeTracking.peekAt, pointer: declarations.pointer }),
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest peek and pointer for Pierre's callbacks, which keeps the viewer's options stable
  useLayoutEffect(() => {
    latest.set({ peekAt: changeTracking.peekAt, pointer: declarations.pointer });
  });

  const [bars] = useState(() => new CSSStyleSheet());

  const [handlers] = useState(() => viewerHandlers(latest.get, bars));

  const viewOptions = {
    ...editorViewOptions({ theme, lineNumbers, wordWrap, codeFontSize }),
    ...handlers,
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- draws the change bars into the editor's own stylesheet, so the viewer's options never change for them
  useLayoutEffect(() => {
    bars.replaceSync(changeBarCss(changeTracking.changes ?? []));
  }, [bars, changeTracking.changes]);

  const blame = useQuery({
    queryKey: ["files", "blame", file.path, snapshot.version],
    queryFn: async () => (await gitFor(workspace)).blame(file.path),
    enabled: gitBlame && active && !dirty,
  });

  const save = async (): Promise<void> => {
    await buffer.save({
      write: (input) => saveFile.mutateAsync({ ...input, expect: input.version }),
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

  // oxlint-disable-next-line nyte-code/no-direct-effect -- resolves the change colours once per appearance on the tab's root, which every viewer the tab mounts inherits
  useLayoutEffect(() => {
    if (root.current !== null) applyDiffScopes(root.current);
  }, [appearance]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- re-renders the imperative viewer when the code font changes
  useLayoutEffect(() => {
    viewer.current?.getInstance()?.render(true);
  }, [codeFont, codeFontSize]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the imperative editor whether it takes typing
  useLayoutEffect(() => {
    viewer.current?.getEditor(file.path)?.setOptions({ readOnly: file.readOnly });
  }, [file.path, file.readOnly]);

  const showTarget = (
    editor: Pick<
      Editor,
      "focus" | "getText" | "getViewState" | "setSelections" | "setViewState" | "getRangeRect"
    >,
  ): boolean => {
    const request = navigation.current;
    const shown = request.target;

    if (!request.active || shown === undefined || appliedNavigation.current >= request.revision)
      return false;
    appliedNavigation.current = request.revision;

    if (shown.kind === "view") {
      editor.setViewState(shown.view);
      editor.focus({ preventScroll: true });
      showCaret(shown.view.selections?.at(-1));

      const primary = shown.view.selections?.at(-1);

      if (primary !== undefined)
        viewer.current?.scrollTo({
          type: "line",
          id: file.path,
          lineNumber: (primary.direction === -1 ? primary.start.line : primary.end.line) + 1,
          align: "center",
        });

      return true;
    }

    const range =
      shown.kind === "lines"
        ? shown.lines
        : { start: shown.line, end: shown.kind === "range" ? shown.endLine : shown.line };

    const column = shown.kind === "lines" ? 0 : (shown.column ?? 1) - 1;
    const at = { line: range.start - 1, character: column };

    if (shown.kind === "lines") viewer.current?.setSelectedLines({ id: file.path, range });

    const current = viewer.current;

    if (current === null) return false;
    revealSelection(current, editor, {
      path: file.path,
      box: root.current,
      selection:
        shown.kind === "lines"
          ? wholeLineSelection(editor.getText(), shown.lines)
          : shown.kind === "match"
            ? {
                start: at,
                end: { line: at.line, character: column + shown.length },
                direction: "forward",
              }
            : shown.kind === "range"
              ? {
                  start: at,
                  end: { line: shown.endLine - 1, character: shown.endColumn - 1 },
                  direction: "forward",
                }
              : { start: at, end: at, direction: "none" },
    });
    showCaret(editor.getViewState().selections?.at(-1));

    return true;
  };

  const attachEditor = (editor: ItemEditor): void => {
    if (editor.getFile() === undefined || attached.current?.editor === editor) return;
    const source = documentEditor(editor);

    attached.current = { editor, source };
    buffer.attach(source);
    showCaret(editor.getViewState().selections?.at(-1));

    if (!showTarget(editor) && scrollTop.current > 0)
      viewer.current?.scrollTo({ type: "position", position: scrollTop.current });
  };

  const [latestEditor] = useState(() => latestValue<ItemEditorCallbacks | undefined>(undefined));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest attach and selection action for Pierre's callbacks, which the editor reads once when it is created
  useLayoutEffect(() => {
    latestEditor.set({
      select: (selections) => selectionChanged.current(selections),
      attach: attachEditor,
      add: addSelection,
    });
  });

  const showCurrentTarget = useEffectEvent(showTarget);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- applies line navigation to the imperative editor before paint
  useLayoutEffect(() => {
    navigation.current = { active, revision: navigationRevision, target: file.target };
    const editor = attached.current?.editor;

    if (editor !== undefined) showCurrentTarget(editor);
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

    const result = await (await filesFor(workspace)).format(file.path, buffer.text());

    if (result.kind === "formatted") buffer.edit(result.contents);
  };

  useImperativeHandle(ref, () => ({ save, discard, format }));

  const revert = (change: LineChange): void => {
    const editor = attached.current?.editor;
    const text = editor?.getEditState()?.document;

    if (editor === undefined || text === undefined) return;
    editor.applyEdits([
      revertEdit(change, {
        lineCount: text.lineCount,
        lineLength: (line) => text.getLineLength(line),
      }),
    ]);
  };

  const contextMenu = nyte.host.contextMenu;
  const revealPath = nyte.host.revealPath;

  const openContextMenu =
    contextMenu === undefined
      ? undefined
      : (event: MouseEvent<HTMLElement>): void => {
          event.preventDefault();
          const lines = shownCaret(caret.get(), navigationRevision, file.target).lines;

          void showContextMenu(contextMenu, event, [
            { kind: "role", role: "cut", label: "Cut" },
            { kind: "role", role: "copy", label: "Copy" },
            { kind: "role", role: "paste", label: "Paste" },
            { kind: "role", role: "selectAll", label: "Select All" },
            { kind: "separator" },
            lines !== undefined && {
              kind: "item",
              label: "Add Selection to Chat",
              accelerator: "CmdOrCtrl+Shift+L",
              run: () => addFileToChat(file, lines),
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

  const blameAt = (line: number): string => {
    const blameLine = blame.data?.lines.find((entry) => entry.line === line);

    return dirty
      ? "Save the file to see up-to-date Git blame."
      : blame.isError
        ? blame.error.message
        : blame.isFetching
          ? "Loading Git blame…"
          : blameLine === undefined
            ? "No Git blame for this line."
            : `${blameLine.author} · ${new Date(blameLine.at).toLocaleDateString()} · ${blameLine.commit.slice(0, 7)}`;
  };

  const saveText =
    snapshot.status.kind === "saving" ? "Saving…" : snapshot.status.kind === "saved" ? "Saved" : "";

  const errorText =
    snapshot.status.kind === "conflict"
      ? "This file changed on disk. Your draft is preserved. Discard changes to reload the disk version."
      : snapshot.status.kind === "error"
        ? snapshot.status.message
        : "";

  const statusVisible = !documentView || gitBlame || saveText !== "" || errorText !== "";

  return (
    <div
      ref={root}
      aria-hidden={!active}
      inert={!active}
      onContextMenu={openContextMenu}
      onAuxClick={documentView ? undefined : declarations.onAuxClick}
      onKeyDown={(event) => {
        if (!documentView && declarations.onKeyDown(event)) return;
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

        if (addSelection(currentEditor()?.getViewState().selections?.at(-1)))
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
          {visible && (
            <FileCodeView
              onViewer={setViewer}
              path={file.path}
              name={file.displayPath}
              editKey={editKey}
              buffer={buffer}
              peekLine={changeTracking.peekLine}
              className={props(diffStyles.patch, styles.code).className}
              createOptions={() =>
                itemEditorOptions({
                  path: file.path,
                  text: () => buffer.text(),
                  readOnly: file.readOnly,
                  mac,
                  latest: latestEditor.get,
                })
              }
              options={viewOptions}
              onEdited={(editor, changes) => {
                const held = attached.current;

                if (held === undefined || held.editor !== editor) return;

                if (buffer.edited(held.source, changes) && project !== undefined)
                  languageDocuments.edited(project.path, file.path, textChanges(changes), () =>
                    buffer.text(),
                  );
              }}
              onEnded={(editor, contents) => {
                const held = attached.current;

                if (held === undefined || held.editor !== editor) return;
                attached.current = undefined;
                buffer.detach(held.source, contents);
              }}
              onScroll={(top) => {
                scrollTop.current = top;
              }}
              renderAnnotation={() =>
                changeTracking.peek !== undefined && (
                  <ChangePeek
                    {...changeTracking.peek}
                    onStep={changeTracking.step}
                    onRevert={() => {
                      const change = changeTracking.peek?.change;

                      if (change !== undefined) revert(change);
                      changeTracking.close();
                    }}
                    onClose={changeTracking.close}
                  />
                )
              }
            />
          )}
          <DeclarationPopups
            popup={declarations.popup}
            api={declarations.api}
            root={project?.path}
            theme={theme}
            mac={mac}
            onPick={declarations.land}
            onPeek={declarations.peekAt}
            onClose={declarations.close}
          />
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
      <div {...props(statusVisible ? viewerStyles.status : srOnly)}>
        {file.readOnly && (
          <span {...props(styles.readOnly)}>
            <Icon name="lock" size="sm" />
            <span>Read-only library file</span>
            <Button
              size="2xs"
              variant="plain"
              onClick={() => fileActions.setReadOnly(viewKey, file.path, false)}
            >
              Edit Anyway
            </Button>
          </span>
        )}
        {gitBlame && (
          <BlameText
            caret={caret}
            revision={navigationRevision}
            target={file.target}
            describe={blameAt}
          />
        )}
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
            <CaretPosition
              caret={caret}
              revision={navigationRevision}
              target={file.target}
              mac={mac}
              onGoToLine={onGoToLine}
            />
          </span>
        )}
      </div>
    </div>
  );
}
