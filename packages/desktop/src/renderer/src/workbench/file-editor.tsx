import { Editor } from "@pierre/diffs/edit";
import { CodeView, EditProvider } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, Ref } from "react";
import type { WorkspaceFileDocument } from "../../../shared/ipc.ts";
import { Button } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { useSaveWorkspaceFile, useWorkspaceFile } from "../queries.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import type { WorkbenchViewKey } from "./controller.ts";
import { createFileDocument } from "./file-document.ts";
import type { FilePreferences } from "./file-preferences.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";

type TextFile = Extract<WorkspaceFileDocument, { readonly kind: "text" }>;

export interface FileEditorHandle {
  save(): Promise<void>;
  discard(): Promise<void>;
}

interface FileEditorProps {
  readonly ref?: Ref<FileEditorHandle>;
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly active: boolean;
  readonly navigationRevision: number;
  readonly preferences: FilePreferences;
}

// The shadow host owns these properties, so inherited overrides cannot replace them.
const EDITOR_CSS = `
:host {
  color-scheme: inherit;
  --diffs-bg: var(--nyte-bg-editor);
}
`;

const styles = create({
  root: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgEditor,
  },
  // Keep each tab's viewport measurable so virtualized editors retain their scroll position.
  hidden: { visibility: "hidden", pointerEvents: "none" },
  code: {
    "--diffs-font-family": t.fontMono,
    "--diffs-font-size": t.fontCode,
    "--diffs-line-height": "var(--nyte-diff-line-height)",
    "--diffs-fg-number-override": t.textTertiary,
    display: "block",
    overflow: "auto",
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  message: {
    padding: 20,
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    minHeight: 26,
    paddingInline: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: t.borderSubtle,
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingSm,
    backgroundColor: t.bgBase,
  },
  error: { color: t.textDanger },
  statusText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

/** Format/reload are ordinary undoable edits; they do not recreate the editor or its history. */
function replaceContents(
  editor: Pick<Editor, "getFile" | "getText" | "applyEdits">,
  contents: string,
): void {
  // CodeView exposes the Editor before its first document has attached.
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
  // Positions cannot address the middle of a CRLF pair.
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

export function WorkspaceFileEditor(input: FileEditorProps): ReactElement {
  const document = useWorkspaceFile(input.file.path);
  if (document.data?.kind === "text") return <TextFileEditor {...input} document={document.data} />;
  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(styles.root, !input.active && styles.hidden)}
    >
      <div role={document.isError ? "alert" : "status"} {...props(styles.message)}>
        {document.isError
          ? `The file could not be opened. ${document.error.message}`
          : document.data?.kind === "binary"
            ? "Binary files cannot be edited here."
            : document.data?.kind === "too_large"
              ? "This file is too large for the workbench editor."
              : "Opening file…"}
      </div>
    </div>
  );
}

function TextFileEditor({
  ref,
  viewKey,
  file,
  active,
  navigationRevision,
  preferences,
  document,
}: FileEditorProps & { readonly document: TextFile }): ReactElement {
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
  const navigation = useRef({
    active,
    revision: navigationRevision,
    line: file.line,
    column: file.column,
    length: file.length,
  });
  const appliedNavigation = useRef(-1);
  const [clickedLine, setClickedLine] = useState({ line: file.line ?? 1, navigationRevision });
  const line =
    clickedLine.navigationRevision === navigationRevision ? clickedLine.line : (file.line ?? 1);
  const appearance = useAppearanceSettings();
  const saveFile = useSaveWorkspaceFile();
  const disk = useWorkspaceFile(file.path);
  const dirty = snapshot.contents !== snapshot.savedContents;
  const blame = useQuery({
    queryKey: ["files", "blame", file.path, snapshot.version],
    queryFn: () => nyte.host.files.blame({ path: file.path }),
    enabled: preferences.gitBlame && active && !dirty,
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

  useLayoutEffect(() => {
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
    };
    synchronize();
    return buffer.subscribe(synchronize);
  }, [buffer, file.path, viewKey]);

  useLayoutEffect(() => {
    buffer.observeDisk(document);
  }, [buffer, document]);

  useLayoutEffect(() => {
    viewer.current?.getInstance()?.render(true);
  }, [appearance.codeFont, appearance.codeFontSize]);

  useLayoutEffect(() => {
    const editor = viewer.current?.getEditor(file.path);
    if (editor instanceof Editor) replaceContents(editor, snapshot.contents);
  }, [file.path, snapshot.contents]);

  const attachEditor = (
    editor: Pick<Editor, "getFile" | "getText" | "applyEdits" | "focus" | "setSelections">,
  ): void => {
    if (editor.getFile() === undefined) return;
    replaceContents(editor, buffer.getSnapshot().contents);
    const target = navigation.current;
    if (!target.active || target.line === undefined || appliedNavigation.current >= target.revision)
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
  };

  useLayoutEffect(() => {
    navigation.current = {
      active,
      revision: navigationRevision,
      line: file.line,
      column: file.column,
      length: file.length,
    };
    const editor = viewer.current?.getEditor(file.path);
    if (editor instanceof Editor) attachEditor(editor);
  });

  const save = (): Promise<void> =>
    buffer.save({
      write: saveFile.mutateAsync,
      format: preferences.formatOnSave ? (input) => nyte.host.files.format(input) : undefined,
    });
  const discard = async (): Promise<void> => {
    if (buffer.getSnapshot().status.kind === "saving")
      throw new Error("Wait for the current save to finish.");
    const result = await disk.refetch();
    if (result.error !== null) throw result.error;
    if (result.data?.kind !== "text") throw new Error("The file can no longer be read as text.");
    buffer.discard(result.data);
  };
  useImperativeHandle(ref, () => ({ save, discard }));

  useEffect(() => {
    if (
      !preferences.autoSave ||
      !dirty ||
      (snapshot.status.kind !== "idle" && snapshot.status.kind !== "saved")
    )
      return;
    const timer = setTimeout(() => {
      void buffer.save({
        write: saveFile.mutateAsync,
        format: preferences.formatOnSave ? (input) => nyte.host.files.format(input) : undefined,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    buffer,
    dirty,
    preferences.autoSave,
    preferences.formatOnSave,
    saveFile.mutateAsync,
    snapshot.revision,
    snapshot.status.kind,
  ]);

  const blameLine =
    blame.data?.kind === "blame"
      ? blame.data.lines.find((entry) => entry.line === line)
      : undefined;
  const blameText = dirty
    ? "Save the file to see up-to-date Git blame."
    : blame.isError
      ? blame.error.message
      : blame.isFetching
        ? "Loading Git blame…"
        : blame.data?.kind === "error" || blame.data?.kind === "unsupported"
          ? blame.data.message
          : blameLine === undefined
            ? "No Git blame for this line."
            : blameLine.uncommitted
              ? "Uncommitted changes"
              : `${blameLine.author} · ${new Date(blameLine.authorTime * 1000).toLocaleDateString()} · ${blameLine.summary}`;

  return (
    <div aria-hidden={!active} inert={!active} {...props(styles.root, !active && styles.hidden)}>
      <EditProvider
        createEditor={(type, options, editStateKey) =>
          new Editor(
            type,
            {
              ...options,
              historyMaxEntries: 200,
              ownsVerticalViewport: true,
              onAttach: attachEditor,
            },
            editStateKey,
          )
        }
      >
        <CodeView
          ref={viewer}
          initialItems={initialItems}
          options={{
            theme: { light: "github-light", dark: "github-dark" },
            themeType: appearance.theme,
            unsafeCSS: EDITOR_CSS,
            disableFileHeader: true,
            disableLineNumbers: !preferences.lineNumbers,
            overflow: preferences.wordWrap ? "wrap" : "scroll",
            onLineClick: (event) => setClickedLine({ line: event.lineNumber, navigationRevision }),
          }}
          className={props(styles.code).className}
          onItemEditChange={(event) => buffer.edit(event.file.contents)}
        />
      </EditProvider>
      {preferences.gitBlame && (
        <div {...props(styles.status)} title={blameText}>
          <span>Line {line}</span>
          <span {...props(styles.statusText)}>{blameText}</span>
          {blame.data?.kind === "blame" && blame.data.truncated && <span>Partial blame</span>}
        </div>
      )}
      {snapshot.status.kind !== "idle" && (
        <div
          role={
            snapshot.status.kind === "error" || snapshot.status.kind === "conflict"
              ? "alert"
              : "status"
          }
          {...props(
            styles.status,
            (snapshot.status.kind === "error" || snapshot.status.kind === "conflict") &&
              styles.error,
          )}
        >
          <span {...props(styles.statusText)}>
            {snapshot.status.kind === "saving"
              ? "Saving…"
              : snapshot.status.kind === "saved"
                ? dirty
                  ? "Unsaved changes"
                  : "Saved"
                : snapshot.status.kind === "conflict"
                  ? "This file changed on disk. Your draft is preserved. Discard changes to reload the disk version."
                  : snapshot.status.message}
          </span>
          {snapshot.status.kind === "error" && (
            <Button variant="ghost" onClick={() => void save()}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
