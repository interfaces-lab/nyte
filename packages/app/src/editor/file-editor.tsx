import { resolveSearchShortcut } from "@nyte-ai/ui/diffs/edit";
import type { EditorSelection, Marker } from "@nyte-ai/ui/diffs/edit";
import type { CodeViewSearch } from "@nyte-ai/ui/diffs";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { use, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findLanguage, LANGUAGES } from "@nyte-ai/schema";
import type { MouseEvent, ReactElement, Ref, RefObject } from "react";
import type { Document, WorkspaceId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { diffStyles } from "../diff/diff.stylex.ts";
import { applyDiffScopes } from "../diff/diff-view.tsx";
import { revealLabel, showContextMenu } from "../components/context-menu.ts";
import type { HostBridge, ThemePreference } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { addFileToChat, addsToChat } from "../references/add-to-chat.ts";
import { selectedLines, settleAddedSelection, shineSelection } from "./editor-selection.ts";
import { ChangePeek, useLineChanges } from "./change-peek.tsx";
import { CompletionList } from "./completion-list.tsx";
import { DeclarationPopups } from "./declaration-popups.tsx";
import { languageDocuments } from "./language-documents.ts";
import { caretPosition, editorRange, selectionRange, textChanges } from "./pierre-language.ts";
import { useCompletion } from "./use-completion.ts";
import { useDeclarations } from "./use-declarations.ts";
import { useDiagnostics } from "./use-diagnostics.ts";
import {
  CaretPosition,
  caretStore,
  FileCodeView,
  itemEditorOptions,
  latestValue,
  shownCaret,
  viewerHandlers,
} from "./file-code-view.tsx";
import type { ItemEditor } from "./file-code-view.tsx";
import { FileBlame } from "./file-blame.tsx";
import { changeBarCss, revertEdit } from "./line-changes.ts";
import type { LineChange } from "./line-changes.ts";
import { keys } from "../data/query-client.ts";
import { useDocument } from "../data/documents.ts";
import { formatBytes } from "../lib/format.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { useAppearance } from "../preferences/appearance-store.ts";
import { watchFamily } from "../data/watch-store.ts";
import { EditorFind } from "./editor-find.tsx";
import { LanguageBar } from "./language-bar.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { intent } from "@nyte-ai/ui/surface-theme";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import type { FileBuffer } from "./file-document.ts";
import { indentUnit, TAB_COLUMNS, visualColumn } from "./indentation.ts";
import { EditorStatusSlot } from "./status-slot.ts";
import { FileImage, FileMessage, FileVideo, RevealButton, viewerStyles } from "./file-viewers.tsx";
import { fileActions } from "./file-store.ts";
import { MarkdownDocument } from "./markdown-document.tsx";
import { FilePdf } from "./file-pdf.tsx";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { opensUnwrapped } from "./long-line.ts";
import { editorViewOptions } from "./editor-view-options.ts";
import type { FileTab } from "./file-store.ts";
import { useEditorSession } from "./use-editor-session.ts";
import { useFileBuffer } from "./use-file-buffer.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

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
  language: { flexShrink: 0, color: role.contentSecondary, whiteSpace: "nowrap" },
});

function IndentationLabel({ path, text }: { readonly path: string; readonly text: string }) {
  const unit = indentUnit(path, text);

  if (unit === undefined) return null;

  return (
    <span {...props(styles.language)}>
      {unit === "\t" ? `Tab Size: ${String(TAB_COLUMNS)}` : `Spaces: ${String(unit.length)}`}
    </span>
  );
}

function languageLabel(path: string): string {
  const name = findLanguage(path)?.name;

  return name === undefined ? "Plain Text" : LANGUAGES[name].label;
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
      ) {
        return;
      }

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

  if (query.data === undefined) {
    return query.isError ? (
      <FileMessage active={input.active} alert title="The file could not be opened.">
        <span {...props(viewerStyles.messageDetail)}>{query.error.message}</span>
        {retry}
      </FileMessage>
    ) : (
      <FileMessage active={input.active} title="Opening file…" />
    );
  }
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
  const statusSlot = use(EditorStatusSlot);

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

  const { caret, showCaret, selectionChanged } = useCaret({ path: file.path, viewer, root });

  const editKey = `${viewKey}\n${file.id}`;

  const currentEditor = () => viewer.current?.getEditor(file.path);

  const addSelection = (selection: EditorSelection | undefined): boolean => {
    const lines = selectedLines(selection);

    if (selection === undefined || lines === undefined || !addFileToChat(file, lines)) return false;
    const editor = currentEditor();

    if (editor !== undefined) settleAddedSelection(editor, selection);

    return true;
  };

  const documentView = opensAsMarkdown(file.path) && !file.showSource;
  const browsed = useWorkbenchWorkspace();

  const workspace =
    browsed.kind === "ready" && workspaceFile(file.path, [browsed.workspace.path]) !== undefined
      ? browsed.workspace.id
      : undefined;

  const project = browsed.kind === "ready" ? browsed.workspace : undefined;

  const { buffer, snapshot, settledText, commands } = useFileBuffer({
    ref,
    viewKey,
    file,
    document,
    autoSave,
    reload,
    workspace,
    project,
  });

  const { declarations, completion, diagnostics } = useLanguageFeatures({
    viewKey,
    file,
    buffer,
    project,
    mac,
    root,
    editor: currentEditor,
    show: (markers) => session.attached.current?.editor.setMarkers(markers),
  });

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

  const handlers = useViewerHandlers({
    peekAt: changeTracking.peekAt,
    pointer: declarations.pointer,
    changes: changeTracking.changes,
  });

  const { theme, options } = useCodeLook({ root, viewer, contents: document.contents });

  const viewOptions = { ...options, ...handlers };

  const session = useEditorSession({
    viewKey,
    editKey,
    file,
    active,
    buffer,
    viewer,
    root,
    showCaret,
    markers: diagnostics.markers,
    select: (selections, revision) => {
      selectionChanged.current(selections, revision);
      completion.moved();
    },
    add: addSelection,
  });

  const revert = (change: LineChange): void => {
    const editor = session.attached.current?.editor;
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
      : (event: MouseEvent<HTMLElement>): void =>
          showFileMenu(contextMenu, event, {
            file,
            lines: shownCaret(caret.get(), navigationRevision, file.target).lines,
            workspace,
            dirty,
            commands,
            revealPath,
          });

  const saveText =
    snapshot.status.kind === "saving"
      ? "Saving…"
      : [
          snapshot.status.kind === "saved" ? "Saved" : "",
          snapshot.formatFailure === null ? "" : `Couldn't format: ${snapshot.formatFailure}`,
        ]
          .filter((part) => part !== "")
          .join(" · ");

  const errorText =
    snapshot.status.kind === "conflict"
      ? "This file changed on disk. Your draft is preserved. Discard changes to reload the disk version."
      : snapshot.status.kind === "error"
        ? snapshot.status.message
        : "";

  const statusVisible = !documentView || saveText !== "" || errorText !== "";

  const status = (
    <>
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
      {workspace !== undefined && !documentView && (
        <FileBlame
          file={file}
          workspace={workspace}
          version={snapshot.version}
          active={active}
          dirty={dirty}
          caret={caret}
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
        <Button onClick={() => void commands.save()}>Retry Save</Button>
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
    </>
  );

  return (
    <div
      ref={root}
      aria-hidden={!active}
      inert={!active}
      onContextMenu={openContextMenu}
      onAuxClick={documentView ? undefined : declarations.onAuxClick}
      onKeyDownCapture={documentView ? undefined : completion.keyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) completion.close();
      }}
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

        if (addSelection(currentEditor()?.getViewState().selections?.at(-1))) {
          event.preventDefault();
        }
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
          <LanguageBar
            path={file.path}
            folder={project}
            onTrusted={() => currentEditor()?.focus()}
          />
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
                  latest: session.callbacks,
                })
              }
              options={viewOptions}
              onEdited={(editor, changes) => {
                const held = session.attached.current;

                if (held === undefined || held.editor !== editor) return;

                if (!buffer.edited(held.source, changes) || project === undefined) {
                  completion.close();

                  return;
                }
                languageDocuments.edited(project.path, file.path, textChanges(changes), () =>
                  buffer.text(),
                );
                completion.edited(changes);
              }}
              onEnded={(editor, contents) => {
                const held = session.release(editor);

                if (held === undefined) return;
                completion.close();
                buffer.detach(held.source, contents);
              }}
              onScroll={(top) => {
                declarations.dismissHover();
                completion.scrolled();
                session.scrolled(top);
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
            onHover={declarations.hoverPopup}
            onRename={declarations.rename}
            onAction={declarations.action}
            folder={project}
          />
          {active && completion.popup !== undefined && (
            <CompletionList
              popup={completion.popup}
              detail={completion.detail}
              folder={project}
              onPick={completion.pick}
              onClose={completion.close}
            />
          )}
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
      {statusSlot === undefined ? (
        <div {...props(statusVisible ? viewerStyles.status : srOnly)}>{status}</div>
      ) : (
        visible &&
        statusSlot !== null &&
        createPortal(
          <>
            {status}
            {!documentView && <IndentationLabel path={file.path} text={settledText} />}
            <span {...props(styles.language)}>{languageLabel(file.path)}</span>
          </>,
          statusSlot,
        )
      )}
    </div>
  );
}

function useCaret(input: {
  readonly path: string;
  readonly viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
  readonly root: RefObject<HTMLDivElement | null>;
}) {
  const { path, viewer, root } = input;
  const [caret] = useState(caretStore);

  const showCaret = (selection: EditorSelection | undefined, revision: number): void => {
    if (selection === undefined) return;
    const focus = selection.direction === -1 ? selection.start : selection.end;
    const lineText = viewer.current?.getEditor(path)?.getLineText(focus.line);

    caret.set({
      revision,
      line: focus.line + 1,
      column:
        lineText === undefined
          ? focus.character + 1
          : visualColumn(lineText, focus.character, TAB_COLUMNS) + 1,
      lines: selectedLines(selection),
    });
  };

  const selectionChanged = useRef(
    (selections: readonly EditorSelection[], revision: number): void => {
      showCaret(selections.at(-1), revision);
    },
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest selection reader for Pierre's callback, which keeps the editor's options stable
  useLayoutEffect(() => {
    selectionChanged.current = (selections, revision) => {
      const primary = selections.at(-1);
      const text = viewer.current?.getEditor(path)?.getEditState()?.document;

      showCaret(primary, revision);

      if (
        primary !== undefined &&
        text !== undefined &&
        window.document.hasFocus() &&
        root.current?.contains(window.document.activeElement) === true
      ) {
        shineSelection(path, text, primary);
      }
    };
  });

  return { caret, showCaret, selectionChanged };
}

function useLanguageFeatures(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly buffer: FileBuffer;
  readonly project: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly mac: boolean;
  readonly root: RefObject<HTMLDivElement | null>;
  readonly editor: () => ItemEditor | undefined;
  readonly show: (markers: Marker[]) => void;
}) {
  const { viewKey, file, project, editor } = input;

  useMountEffect(() => () => {
    if (project !== undefined) languageDocuments.closed(project.path, file.path);
  });

  const declarations = useDeclarations({
    viewKey,
    path: file.path,
    buffer: input.buffer,
    workspace: project,
    mac: input.mac,
    readOnly: file.readOnly,
    caret: () => caretPosition(editor()?.getViewState().selections?.at(-1)),
    selection: () => selectionRange(editor()?.getViewState().selections?.at(-1)),
    rangeRect: (range) => editor()?.getRangeRect(editorRange(range)),
    fallbackRect: () => input.root.current?.getBoundingClientRect() ?? new DOMRect(),
    diagnosed: (position) => diagnostics.diagnosed(position),
    nearestProblem: (position) => diagnostics.nearest(position),
    focus: () => editor()?.focus(),
  });

  const completion = useCompletion({
    viewKey,
    path: file.path,
    workspace: project,
    readOnly: file.readOnly,
    editor,
  });

  const diagnostics = useDiagnostics({
    viewKey,
    path: file.path,
    workspace: project,
    mac: input.mac,
    readOnly: file.readOnly,
    show: input.show,
    onQuickFix: declarations.showFixes,
  });

  return { declarations, completion, diagnostics };
}

type ViewerLatest = ReturnType<Parameters<typeof viewerHandlers>[0]>;

function useViewerHandlers(
  input: ViewerLatest & { readonly changes: readonly LineChange[] | undefined },
) {
  const [latest] = useState(() => latestValue({ peekAt: input.peekAt, pointer: input.pointer }));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest peek and pointer for Pierre's callbacks, which keeps the viewer's options stable
  useLayoutEffect(() => {
    latest.set({ peekAt: input.peekAt, pointer: input.pointer });
  });

  const [bars] = useState(() => new CSSStyleSheet());

  const [handlers] = useState(() => viewerHandlers(latest.get, bars));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- draws the change bars into the editor's own stylesheet, so the viewer's options never change for them
  useLayoutEffect(() => {
    bars.replaceSync(changeBarCss(input.changes ?? []));
  }, [bars, input.changes]);

  return handlers;
}

function useCodeLook(input: {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
  readonly contents: string;
}) {
  const { root, viewer } = input;
  const appearance = useAppearance();
  const theme: ThemePreference = appearance.dark ? "dark" : "light";
  const codeFont = useSetting(preferences.codeFont);
  const codeFontSize = useSetting(preferences.codeFontSize);
  const lineNumbers = useSetting(preferences.fileLineNumbers);
  const wordWrap = useSetting(preferences.fileWordWrap) && !opensUnwrapped(input.contents);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- resolves the change colours once per appearance on the tab's root, which every viewer the tab mounts inherits
  useLayoutEffect(() => {
    if (root.current !== null) applyDiffScopes(root.current);
  }, [appearance, root]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- re-renders the imperative viewer when the code font changes
  useLayoutEffect(() => {
    viewer.current?.getInstance()?.render(true);
  }, [codeFont, codeFontSize, viewer]);

  return { theme, options: editorViewOptions({ theme, lineNumbers, wordWrap, codeFontSize }) };
}

function showFileMenu(
  contextMenu: NonNullable<HostBridge["contextMenu"]>,
  event: MouseEvent<HTMLElement>,
  input: {
    readonly file: FileTab;
    readonly lines: ReturnType<typeof selectedLines>;
    readonly workspace: WorkspaceId | undefined;
    readonly dirty: boolean;
    readonly commands: FileEditorHandle;
    readonly revealPath: HostBridge["revealPath"];
  },
): void {
  const { file, lines, commands, revealPath } = input;

  event.preventDefault();

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
    input.workspace !== undefined && {
      kind: "item",
      label: "Format Document",
      run: () => void commands.format(),
    },
    {
      kind: "item",
      label: "Save",
      accelerator: "CmdOrCtrl+S",
      enabled: input.dirty,
      run: () => void commands.save(),
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
}
