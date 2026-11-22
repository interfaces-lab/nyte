import type { PostRenderPhase } from "@nyte-ai/ui/diffs";
import { Editor } from "@nyte-ai/ui/diffs/edit";
import type {
  EditorChange,
  EditorOptions,
  EditorSelection,
  EditorType,
} from "@nyte-ai/ui/diffs/edit";
import { CodeView, EditProvider } from "@nyte-ai/ui/diffs/react";
import type { CodeViewHandle, CodeViewItem, CodeViewReactOptions } from "@nyte-ai/ui/diffs/react";
import { Button } from "@nyte-ai/ui/button";
import { props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { selectionAction } from "./editor-selection.ts";
import { EDITOR_KEYMAP } from "./editor-keymap.ts";
import type { DocumentEditor, FileBuffer } from "./file-document.ts";
import type { FileTab } from "./file-store.ts";
import { viewerStyles } from "./file-viewers.tsx";
import { indentUnit } from "./indentation.ts";
import { changeEdits, replaceContents } from "./outside-edits.ts";
import { tokenHooks } from "./pierre-language.ts";

/** An editor CodeView made for one of its items. */
export type ItemEditor = Editor;

type Pointer = Parameters<typeof tokenHooks>[0];

export interface ItemEditorCallbacks {
  readonly select: (selections: readonly EditorSelection[]) => void;
  readonly attach: (editor: ItemEditor) => void;
  readonly add: (selection: EditorSelection | undefined) => boolean;
}

export function createEditor<EType extends EditorType>(
  editorType: EType,
  options: EditorOptions<EType, undefined, undefined>,
  editStateKey?: string,
): Editor<EType> {
  return new Editor(editorType, options, editStateKey);
}

/**
 * The Pierre viewer of one shown tab: one CodeView with one edited item, mounted while the tab is its group's shown
 * one. The edit session is keyed by the tab, so a tab shown again resumes its document, history, selections and
 * horizontal scroll; the vertical position belongs to the viewer, and the tab restores it with `scrollTo`.
 */
export function FileCodeView(input: {
  readonly onViewer: (viewer: CodeViewHandle<undefined, undefined> | null) => void;
  readonly path: string;
  readonly name: string;
  readonly editKey: string;
  readonly buffer: FileBuffer;
  readonly peekLine: number | undefined;
  readonly className: string | undefined;
  readonly createOptions: () => Omit<EditorOptions<EditorType, undefined, undefined>, "onChange">;
  readonly options: CodeViewReactOptions<undefined, undefined>;
  readonly onEdited: (editor: ItemEditor, changes: readonly EditorChange[]) => void;
  readonly onEnded: (editor: ItemEditor, contents: string) => void;
  readonly onScroll: (top: number) => void;
  readonly renderAnnotation: () => ReactNode;
}): ReactElement {
  const [initialItems] = useState<readonly CodeViewItem<undefined>[]>(() => [
    {
      id: input.path,
      type: "file",
      edit: true,
      file: {
        name: input.name,
        contents: input.buffer.text(),
        cacheKey: `${input.path}@${String(input.buffer.getSnapshot().revision)}`,
      },
      annotations: input.peekLine === undefined ? [] : [{ lineNumber: input.peekLine }],
    },
  ]);

  const [editorOptions] = useState(input.createOptions);
  const [editStateKey] = useState(() => () => input.editKey);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const publish = input.onViewer;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- hands the viewer to the tab's editor before its layout effects read it, and takes it back on unmount
  useLayoutEffect(() => {
    publish(viewer.current);

    return () => publish(null);
  }, [publish]);

  return (
    <EditProvider createEditor={createEditor}>
      <CodeView
        initialItems={initialItems}
        editorOptions={editorOptions}
        getEditStateKey={editStateKey}
        options={input.options}
        className={input.className}
        onScroll={input.onScroll}
        onItemEditChange={(event) => input.onEdited(event.editor, event.changes)}
        onItemEditComplete={(event, item, next) => {
          if (!("file" in event)) return "reject";
          input.onEnded(event.editor, event.file.contents);
          event.file.cacheKey = `${input.path}@${String(input.buffer.getSnapshot().revision)}.${String(next.version)}`;

          return "accept";
        }}
        renderAnnotation={input.renderAnnotation}
        ref={viewer}
      />
    </EditProvider>
  );
}

/**
 * The viewer's callbacks, made once per tab so the viewer's options stay equal across renders: the gutter click that
 * peeks a change, the token hooks for Go to Declaration, and the post-render hook that adopts the change-bar sheet.
 */
export function viewerHandlers(
  latest: () => { readonly peekAt: (line: number) => void; readonly pointer: Pointer },
  bars: CSSStyleSheet,
) {
  return {
    onLineNumberClick: (event: { readonly lineNumber: number }) =>
      latest().peekAt(event.lineNumber),
    onPostRender: (...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void => {
      if (phase !== "unmount") adoptSheet(node, bars);
    },
    ...tokenHooks({
      enter: (word, event) => latest().pointer.enter(word, event),
      leave: (element) => latest().pointer.leave(element),
      click: (word, event) => latest().pointer.click(word, event),
    }),
  };
}

/** The options an item's editor is created with; Pierre reads them once, when the tab's viewer mounts. */
export function itemEditorOptions(input: {
  readonly path: string;
  readonly text: () => string;
  readonly readOnly: boolean;
  readonly mac: boolean;
  readonly latest: () => ItemEditorCallbacks | undefined;
}): Omit<EditorOptions<EditorType, undefined, undefined>, "onChange"> {
  return {
    historyMaxEntries: 200,
    addCaretGesture: "alt-shift-click",
    indentUnit: indentUnit(input.path, input.text()),
    autoClosePairs: true,
    keymap: EDITOR_KEYMAP,
    readOnly: input.readOnly,
    onSelectionChange: (selections) => input.latest()?.select(selections),
    onAttach: (editor) => input.latest()?.attach(editor),
    enabledSelectionAction: true,
    renderSelectionAction: (context) =>
      selectionAction(input.mac, () => {
        if (input.latest()?.add(context.selection) === true) context.close();
      }),
  };
}

/** A value callbacks read at call time, set after each render, for the callbacks Pierre reads once. */
export function latestValue<Value>(initial: Value) {
  let value = initial;

  return {
    get: (): Value => value,
    set: (next: Value): void => {
      value = next;
    },
  };
}

function adoptSheet(node: HTMLElement, sheet: CSSStyleSheet): void {
  const shadow = node.shadowRoot;

  if (shadow === null || shadow.adoptedStyleSheets.includes(sheet)) return;
  shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
}

/** The document's view of a Pierre editor: text and length read on demand, and edits as small as the change. */
export function documentEditor(editor: ItemEditor): DocumentEditor {
  return {
    text: () => editor.getText(),
    length: () => {
      const text = editor.getEditState()?.document;

      if (text === undefined) return editor.getText().replaceAll(/\r\n|\r/gu, "\n").length;
      const last = text.lineCount - 1;

      return text.offsetAt({ line: last, character: text.getLineLength(last) });
    },
    replace: (contents) => replaceContents(editor, contents),
    apply: (changes) => editor.applyEdits([...changeEdits(changes)]),
    alive: () => editor.getFile() !== undefined,
  };
}

interface Caret {
  readonly revision: number;
  readonly line?: number;
  readonly column?: number;
  readonly lines?: { readonly start: number; readonly end: number };
}

/**
 * Where the caret is, kept outside React state: Pierre reports every caret move, and only the status bar's position
 * and blame read it, so the editor itself never re-renders for one.
 */
export function caretStore() {
  let caret: Caret = { revision: -1 };
  const listeners = new Set<() => void>();

  return {
    get: (): Caret => caret,
    set: (next: Caret): void => {
      caret = next;

      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type CaretStore = ReturnType<typeof caretStore>;

/** The caret the status bar shows: the editor's, or the navigation target's until the editor reports one. */
export function shownCaret(caret: Caret, revision: number, target: FileTab["target"]) {
  const own = caret.revision === revision ? caret : undefined;

  return {
    line:
      own?.line ??
      (target?.kind === "lines"
        ? target.lines.start
        : target?.kind === "view"
          ? undefined
          : target?.line) ??
      1,
    column:
      own?.column ??
      (target?.kind === "lines" ? 1 : target?.kind === "view" ? undefined : target?.column) ??
      1,
    lines: own?.lines,
  };
}

export function CaretPosition(input: {
  readonly caret: CaretStore;
  readonly revision: number;
  readonly target: FileTab["target"];
  readonly mac: boolean;
  readonly onGoToLine: () => void;
}): ReactElement {
  const current = useSyncExternalStore(input.caret.subscribe, input.caret.get);
  const shown = shownCaret(current, input.revision, input.target);

  const position =
    shown.lines === undefined || shown.lines.start === shown.lines.end
      ? `Ln ${String(shown.line)}, Col ${String(shown.column)}`
      : `${String(shown.lines.end - shown.lines.start + 1)} lines selected`;

  return (
    <Button
      size="2xs"
      variant="plain"
      title={`Go to Line (${input.mac ? "⌃G" : "Ctrl+G"})`}
      onClick={input.onGoToLine}
    >
      {position}
    </Button>
  );
}

export function BlameText(input: {
  readonly caret: CaretStore;
  readonly revision: number;
  readonly target: FileTab["target"];
  readonly describe: (line: number) => string;
}): ReactElement {
  const current = useSyncExternalStore(input.caret.subscribe, input.caret.get);
  const text = input.describe(shownCaret(current, input.revision, input.target).line);

  return (
    <span title={text} {...props(viewerStyles.statusText)}>
      {text}
    </span>
  );
}
