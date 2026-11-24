import { EditStateManager } from "@nyte-ai/ui/diffs/edit";
import type { Editor, EditorSelection, Marker, Range } from "@nyte-ai/ui/diffs/edit";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { revealSelection, wholeLineSelection } from "./editor-selection.ts";
import { documentEditor, latestValue } from "./file-code-view.tsx";
import type { ItemEditor, ItemEditorCallbacks } from "./file-code-view.tsx";
import type { DocumentEditor, FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab, FileTarget } from "./file-store.ts";

interface Attachment {
  readonly editor: ItemEditor;
  readonly source: DocumentEditor;
}

/**
 * The tab's session with its imperative editor: attaching it to the buffer, applying the tab's navigation and
 * keyboard focus, keeping its scroll for the next attach, and giving its view state to the file store.
 */
export function useEditorSession(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly editKey: string;
  readonly file: FileTab;
  readonly active: boolean;
  readonly buffer: FileBuffer;
  readonly viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
  readonly root: RefObject<HTMLDivElement | null>;
  readonly showCaret: (selection: EditorSelection | undefined, revision: number) => void;
  readonly markers: () => Marker[];
  readonly select: (selections: readonly EditorSelection[], revision: number) => void;
  readonly add: ItemEditorCallbacks["add"];
}) {
  const { viewKey, editKey, file, active, buffer, viewer, root, showCaret } = input;
  const navigationRevision = file.navigationRevision;

  const navigation = useRef({ active, revision: navigationRevision, target: file.target });

  const appliedNavigation = useRef(-1);

  const scrollTop = useRef(0);

  const attached = useRef<Attachment>(undefined);

  useMountEffect(() =>
    fileActions.track(file.id, () => {
      const view = viewer.current?.getEditor(file.path)?.getViewState();

      return view?.selections === undefined ? undefined : { kind: "view", view };
    }),
  );

  useMountEffect(() => () => {
    if (!fileActions.holds(viewKey, file.id)) EditStateManager.clear("file", editKey);
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the imperative editor whether it takes typing
  useLayoutEffect(() => {
    viewer.current?.getEditor(file.path)?.setOptions({ readOnly: file.readOnly });
  }, [file.path, file.readOnly, viewer]);

  const showTarget = (
    editor: Pick<
      Editor,
      "focus" | "getText" | "getViewState" | "setSelections" | "setViewState" | "getRangeRect"
    >,
  ): boolean => {
    const request = navigation.current;
    const shown = request.target;

    if (!request.active || shown === undefined || appliedNavigation.current >= request.revision) {
      return false;
    }
    appliedNavigation.current = request.revision;

    if (shown.kind === "view") {
      editor.setViewState(shown.view);
      editor.focus({ preventScroll: true });
      showCaret(shown.view.selections?.at(-1), navigation.current.revision);

      const primary = shown.view.selections?.at(-1);

      if (primary !== undefined) {
        viewer.current?.scrollTo({
          type: "line",
          id: file.path,
          lineNumber: (primary.direction === -1 ? primary.start.line : primary.end.line) + 1,
          align: "center",
        });
      }

      return true;
    }

    if (shown.kind === "lines") {
      viewer.current?.setSelectedLines({ id: file.path, range: shown.lines });
    }

    const current = viewer.current;

    if (current === null) return false;
    revealSelection(current, editor, {
      path: file.path,
      box: root.current,
      selection: targetSelection(shown, editor),
    });
    showCaret(editor.getViewState().selections?.at(-1), navigation.current.revision);

    return true;
  };

  const takeKeyboard = (editor: Pick<Editor, "focus" | "getViewState" | "setSelections">): void => {
    if ((editor.getViewState().selections ?? []).length === 0) {
      const start = { line: 0, character: 0 };

      editor.setSelections([{ start, end: start, direction: "none" }]);
    }
    editor.focus({ preventScroll: true });
  };

  const attachEditor = (editor: ItemEditor): void => {
    if (editor.getFile() === undefined || attached.current?.editor === editor) return;
    const source = documentEditor(editor);

    attached.current = { editor, source };
    buffer.attach(source);
    editor.setMarkers(input.markers());
    showCaret(editor.getViewState().selections?.at(-1), navigation.current.revision);

    if (!showTarget(editor) && scrollTop.current > 0) {
      viewer.current?.scrollTo({ type: "position", position: scrollTop.current });
    }

    if (active && fileActions.takeFocus(file.id)) takeKeyboard(editor);
  };

  const [latestEditor] = useState(() => latestValue<ItemEditorCallbacks | undefined>(undefined));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest attach and selection action for Pierre's callbacks, which the editor reads once when it is created
  useLayoutEffect(() => {
    latestEditor.set({
      select: (selections) => input.select(selections, navigation.current.revision),
      attach: attachEditor,
      add: input.add,
    });
  });

  const showCurrentTarget = useEffectEvent(showTarget);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- applies line navigation to the imperative editor before paint
  useLayoutEffect(() => {
    navigation.current = { active, revision: navigationRevision, target: file.target };
    const editor = attached.current?.editor;

    if (editor !== undefined) showCurrentTarget(editor);
  }, [active, file.path, file.target, navigationRevision]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- hands the keyboard to the imperative editor once it is attached
  useLayoutEffect(() => {
    const editor = attached.current?.editor;

    if (active && editor !== undefined && fileActions.takeFocus(file.id)) takeKeyboard(editor);
  }, [active, file.id, file.wantsFocus]);

  return {
    attached,
    callbacks: latestEditor.get,
    scrolled: (top: number): void => {
      scrollTop.current = top;
    },
    release: (editor: ItemEditor): Attachment | undefined => {
      const held = attached.current;

      if (held === undefined || held.editor !== editor) return undefined;
      attached.current = undefined;

      return held;
    },
  };
}

function targetSelection(
  target: Exclude<FileTarget, { readonly kind: "view" }>,
  editor: Pick<Editor, "getText">,
): Range & { readonly direction: "none" | "forward" | "backward" } {
  if (target.kind === "lines") return wholeLineSelection(editor.getText(), target.lines);
  const column = (target.column ?? 1) - 1;
  const at = { line: target.line - 1, character: column };

  if (target.kind === "match") {
    return {
      start: at,
      end: { line: at.line, character: column + target.length },
      direction: "forward",
    };
  }

  if (target.kind === "range") {
    return {
      start: at,
      end: { line: target.endLine - 1, character: target.endColumn - 1 },
      direction: "forward",
    };
  }

  return { start: at, end: at, direction: "none" };
}
