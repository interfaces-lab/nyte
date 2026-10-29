import { props } from "@stylexjs/stylex";
import type { Editor, EditorEvents } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, Ref } from "react";
import type { MentionFile } from "./message-references.ts";
import {
  clearComposerHistory,
  COMPOSER_RESTORE,
  composerCompletion,
  composerReferences,
  composerSubmission,
  insertComposerReference,
  pasteComposerText,
  readComposerDocument,
  refreshComposerReferences,
  replaceComposerText,
  restoreComposerDocument,
  sameComposerDocument,
} from "./composer-document.ts";
import type {
  ComposerCompletion,
  ComposerDocumentState,
  ComposerSubmission,
} from "./composer-document.ts";
import {
  ComposerSurfaceContent,
  editorContentStyle,
  editorRoot,
  focusComposer,
  useComposerSurface,
} from "./composer-surface.tsx";
import { clipboardReferenceFromPaste } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { composerStyles } from "./composer.stylex.ts";

export interface ComposerEditorHandle {
  readElement(): HTMLDivElement | null;
  focus(options?: FocusOptions): void;
  read(): ComposerSubmission;
  readDocument(): ComposerDocumentState;
  replaceText(start: number, end: number, text: string): void;
  insertReference(reference: MessageReference, start?: number, end?: number): void;
  dropReferences(references: readonly MessageReference[], clientX: number, clientY: number): void;
  attachFiles(files: readonly File[]): void;
}

export interface ComposerComboboxState {
  readonly expanded: boolean;
  readonly popupId: string | undefined;
  readonly activeOption: string | undefined;
}

interface ComposerEditorProps {
  readonly ref: Ref<ComposerEditorHandle>;
  readonly inputRef?: (handle: ComposerEditorHandle | null) => void;
  readonly className?: string;
  readonly label?: string;
  readonly document: ComposerDocumentState;
  readonly onDocumentChange: (
    document: ComposerDocumentState,
    completion: ComposerCompletion | undefined,
  ) => void;
  readonly onReferencesChange?: (references: readonly MessageReference[]) => void;
  readonly files: readonly MentionFile[];
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly combobox?: ComposerComboboxState;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly onFocusChange?: (focused: boolean) => void;
  readonly onFilesSelected?: (files: readonly File[]) => void;
}

interface CaretBox {
  readonly x: number;
  readonly top: number;
  readonly height: number;
}

function nodeRects(node: Node): readonly DOMRect[] {
  if (node instanceof Element) return Array.from(node.getClientRects());

  if (!(node instanceof Text)) return [];
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);

  return Array.from(range.getClientRects());
}

function caretBox(range: Range): CaretBox | undefined {
  const own = range.getClientRects()[0];

  if (own !== undefined && own.height > 0) return { x: own.left, top: own.top, height: own.height };
  const container = range.startContainer;
  const siblings = container instanceof Text ? [] : Array.from(container.childNodes);
  const before = siblings[range.startOffset - 1];
  const after = siblings[range.startOffset];

  if (before?.nodeName === "BR") {
    const line = nodeRects(before).at(-1);
    const block = container instanceof Element ? container.getBoundingClientRect() : undefined;

    if (line !== undefined && line.height > 0 && block !== undefined) {
      return { x: block.left, top: line.bottom, height: line.height };
    }
  }

  const beforeRect =
    before === undefined || before.nodeName === "BR" ? undefined : nodeRects(before).at(-1);

  if (beforeRect !== undefined && beforeRect.height > 0) {
    return { x: beforeRect.right, top: beforeRect.top, height: beforeRect.height };
  }

  const afterRect =
    after === undefined || after.nodeName === "BR" ? undefined : nodeRects(after)[0];

  if (afterRect !== undefined && afterRect.height > 0) {
    return { x: afterRect.left, top: afterRect.top, height: afterRect.height };
  }

  const element = container instanceof Element ? container : container.parentElement;
  const rect = element?.getBoundingClientRect();

  if (rect === undefined || rect.height === 0) return undefined;

  return { x: rect.left, top: rect.top, height: rect.height };
}

function refreshReferences(editor: Editor, catalog: ReadonlyMap<string, MentionFile>): void {
  const tr = refreshComposerReferences(editor.state.tr, catalog);

  if (tr.docChanged) editor.view.dispatch(tr);
}

function restoreDocument(editor: Editor, document: ComposerDocumentState): void {
  const view = editor.view;
  const tr = restoreComposerDocument(editor.state.tr, document);
  view.dispatch(view.hasFocus() ? tr.scrollIntoView() : tr);
  view.updateState(clearComposerHistory(view.state));
}

function indexFilesByUrl(files: readonly MentionFile[]): ReadonlyMap<string, MentionFile> {
  return new Map(files.map((file) => [file.url, file]));
}

export function ComposerEditor({
  ref,
  inputRef,
  className,
  label = "Message",
  document: externalDocument,
  onDocumentChange,
  onReferencesChange,
  files,
  disabled,
  placeholder,
  combobox,
  onKeyDown,
  onFocusChange,
  onFilesSelected,
}: ComposerEditorProps): ReactElement {
  const catalog = indexFilesByUrl(files);
  const catalogRef = useRef(catalog);

  const editor = useComposerSurface({
    text: externalDocument.text,
    files: () => catalogRef.current,
    editable: true,
  });

  const caretRef = useRef<HTMLSpanElement>(null);
  const reported = useRef<ComposerDocumentState | undefined>(undefined);
  const observed = useRef<ComposerDocumentState | undefined>(undefined);
  const lastReferences = useRef<readonly MessageReference[]>([]);
  const onFilesSelectedRef = useRef(onFilesSelected);

  const [handle] = useState((): ComposerEditorHandle => ({
    readElement: () => {
      const root = editorRoot(editor);

      return root instanceof HTMLDivElement ? root : null;
    },
    focus: (options) => focusComposer(editor, options),
    read() {
      return composerSubmission(editor.state.doc);
    },
    readDocument() {
      const document = readComposerDocument(editor.state);
      observed.current = document;

      return document;
    },
    replaceText(start, end, text) {
      focusComposer(editor, { preventScroll: true });
      editor.view.dispatch(
        closeHistory(replaceComposerText(editor.state.tr, start, end, text)).scrollIntoView(),
      );
    },
    insertReference(reference, start, end) {
      focusComposer(editor, { preventScroll: true });
      editor.view.dispatch(
        closeHistory(
          insertComposerReference(editor.state.tr, reference, start, end),
        ).scrollIntoView(),
      );
    },
    dropReferences(references, clientX, clientY) {
      const view = editor.view;
      const page = view.dom.ownerDocument;

      const caret =
        "caretPositionFromPoint" in page ? page.caretPositionFromPoint(clientX, clientY) : null;

      focusComposer(editor, { preventScroll: true });
      const tr = editor.state.tr;

      if (
        caret !== null &&
        caret.offsetNode instanceof Text &&
        caret.offsetNode.parentElement?.isContentEditable === true &&
        view.dom.contains(caret.offsetNode)
      )
        tr.setSelection(
          TextSelection.create(tr.doc, view.posAtDOM(caret.offsetNode, caret.offset)),
        );

      for (const reference of references) insertComposerReference(tr, reference);
      view.dispatch(closeHistory(tr).scrollIntoView());
    },
    attachFiles(files) {
      onFilesSelectedRef.current?.(files);
    },
  }));

  useImperativeHandle(ref, () => handle, [handle]);
  useImperativeHandle(inputRef, () => handle, [handle]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- latest onFilesSelected for Tiptap's paste handler, which outlives renders
  useLayoutEffect(() => {
    onFilesSelectedRef.current = onFilesSelected;
  }, [onFilesSelected]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- pushes editable state and aria attributes into Tiptap before paint
  useLayoutEffect(
    () =>
      editor.setOptions({
        editable: !disabled,
        editorProps: {
          attributes: (state) =>
            Object.fromEntries(
              Object.entries({
                class: className,
                role: combobox === undefined ? "textbox" : "combobox",
                "aria-label": label,
                "aria-multiline": "true",
                "aria-autocomplete": combobox === undefined ? undefined : "list",
                "aria-expanded": combobox === undefined ? undefined : String(combobox.expanded),
                "aria-controls": combobox?.popupId,
                "aria-activedescendant": combobox?.activeOption,
                "aria-disabled": String(disabled),
                "data-placeholder": placeholder,
                "data-empty": String(state.doc.firstChild?.childCount === 0),
              }).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
          handleKeyDown: (view, event) => {
            if (event.isComposing || view.composing) return false;
            onKeyDown(event);

            return event.defaultPrevented;
          },
          handlePaste: (view, event) => {
            const pasted = Array.from(event.clipboardData?.files ?? []);

            if (pasted.length > 0 && onFilesSelected !== undefined) {
              onFilesSelected(pasted);

              return true;
            }

            const text = event.clipboardData?.getData("text/plain") ?? "";
            const clipboard = clipboardReferenceFromPaste(text);

            view.dispatch(
              (clipboard === undefined
                ? pasteComposerText(view.state.tr, text)
                : closeHistory(insertComposerReference(view.state.tr, clipboard))
              ).scrollIntoView(),
            );

            return true;
          },
        },
      }),
    [className, combobox, disabled, editor, label, onFilesSelected, onKeyDown, placeholder],
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- Tiptap transaction subscription with the current callbacks
  useLayoutEffect(() => {
    const report = (external: boolean): void => {
      const { state } = editor;
      const next = readComposerDocument(state);
      observed.current = next;

      if (editor.view.composing) return;

      const references = composerReferences(state.doc);

      const previousReferences = lastReferences.current;

      const referencesChanged =
        references.length !== previousReferences.length ||
        references.some((reference, index) => reference !== previousReferences[index]);

      if (referencesChanged) {
        lastReferences.current = references;
        onReferencesChange?.(references);
      }

      const previous = reported.current;

      if (previous !== undefined && sameComposerDocument(previous, next)) return;
      reported.current = next;
      onDocumentChange(next, external ? undefined : composerCompletion(state, next.selectionStart));
    };

    const onTransaction = ({ transaction }: EditorEvents["transaction"]): void =>
      report(transaction.getMeta(COMPOSER_RESTORE) === true);

    const onCompositionEnd = (): void => report(false);
    const root = editor.view.dom;
    editor.on("transaction", onTransaction);
    root.addEventListener("compositionend", onCompositionEnd);

    return () => {
      editor.off("transaction", onTransaction);
      root.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [editor, onDocumentChange, onReferencesChange]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- refreshes reference chips in Tiptap before paint
  useLayoutEffect(() => {
    catalogRef.current = catalog;
    refreshReferences(editor, catalog);
  }, [catalog, editor]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- writes an outside draft into Tiptap before paint
  useLayoutEffect(() => {
    const current = observed.current;

    if (current !== undefined && sameComposerDocument(current, externalDocument)) return;
    restoreDocument(editor, externalDocument);
  }, [editor, externalDocument]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- draws the custom caret from the DOM selection before paint
  useLayoutEffect(() => {
    const root = editor.view.dom;
    const caret = caretRef.current;

    if (caret === null) return;
    let frame = 0;
    let lastPosition = "";
    const glyph = root.ownerDocument.createRange();
    glyph.selectNodeContents(caret);

    const draw = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = root.ownerDocument.getSelection();

        const visible =
          root.ownerDocument.activeElement === root &&
          !editor.view.composing &&
          selection !== null &&
          selection.isCollapsed &&
          selection.rangeCount > 0 &&
          root.contains(selection.anchorNode);

        if (!visible) {
          caret.hidden = true;
          root.dataset["customCaret"] = "false";

          return;
        }

        const box = caretBox(selection.getRangeAt(0));

        if (box === undefined) {
          caret.hidden = true;
          root.dataset["customCaret"] = "false";

          return;
        }

        const bounds = root.getBoundingClientRect();
        const typography = getComputedStyle(root);
        const lineHeight = Number.parseFloat(typography.lineHeight);
        caret.style.font = typography.font;
        const height = Math.min(glyph.getBoundingClientRect().height || lineHeight, lineHeight);
        const x = box.x - bounds.left;
        const y = box.top - bounds.top + Math.max(0, (box.height - height) / 2);
        const inView = y >= 0 && y + height <= root.clientHeight + 1;
        caret.hidden = !inView;
        root.dataset["customCaret"] = String(inView);
        const position = `translate(${String(x)}px, ${String(y)}px)`;
        caret.style.transform = position;
        caret.style.height = `${String(height)}px`;

        if (position !== lastPosition) {
          for (const animation of caret.getAnimations()) animation.currentTime = 0;
        }

        lastPosition = position;
      });
    };

    const ownerDocument = root.ownerDocument;
    ownerDocument.addEventListener("selectionchange", draw);
    root.addEventListener("focus", draw);
    root.addEventListener("blur", draw);
    root.addEventListener("scroll", draw);
    root.addEventListener("compositionstart", draw);
    root.addEventListener("compositionend", draw);
    const observer = new ResizeObserver(draw);
    observer.observe(root);
    const typographyObserver = new MutationObserver(draw);
    typographyObserver.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    typographyObserver.observe(ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-display-mode"],
    });
    ownerDocument.fonts.addEventListener("loadingdone", draw);
    editor.on("transaction", draw);

    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", draw);
      observer.disconnect();
      typographyObserver.disconnect();
      ownerDocument.fonts.removeEventListener("loadingdone", draw);
      ownerDocument.removeEventListener("selectionchange", draw);
      root.removeEventListener("focus", draw);
      root.removeEventListener("blur", draw);
      root.removeEventListener("scroll", draw);
      root.removeEventListener("compositionstart", draw);
      root.removeEventListener("compositionend", draw);
    };
  }, [editor]);

  return (
    <div {...props(composerStyles.editorHost)}>
      <ComposerSurfaceContent
        editor={editor}
        style={editorContentStyle}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
      />
      <span
        ref={caretRef}
        hidden
        aria-hidden="true"
        data-composer-caret=""
        {...props(composerStyles.editorCaret)}
      >
        {String.fromCodePoint(0x200b)}
      </span>
    </div>
  );
}
