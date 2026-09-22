/**
 * The editable surface. Lexical owns the document, the selection, the IME,
 * the clipboard, and history; React owns the chips it portals into Lexical's
 * decorator hosts and the caret it draws over the native one.
 *
 * The editor is uncontrolled. Its parent hands it a document and receives one
 * back after every edit; a document that matches the editor's last observed
 * state is the parent echoing what it was told and changes nothing here. A
 * different document (a restored draft, another pane's draft, a clear)
 * replaces the content and the caret and starts history afresh. Lexical keeps
 * its range selection while the editor is blurred, so focusing later returns
 * the caret to where the draft left it.
 */
import { props } from "@stylexjs/stylex";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, Ref } from "react";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $addUpdateTag,
  $getNodeByKey,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical";
import type { MentionFile } from "@nyte-ai/client";
import {
  $composerCompletion,
  $composerReferences,
  $composerSubmission,
  $insertComposerReference,
  $readComposerDocument,
  $replaceComposerText,
  $restoreComposerDocument,
  COMPOSER_EXTERNAL_TAG,
  registerComposerReferences,
  sameComposerDocument,
} from "./composer-document.ts";
import type {
  ComposerCompletion,
  ComposerDocumentState,
  ComposerSubmission,
} from "./composer-document.ts";
import { ComposerDecorators, useComposerSurface } from "./composer-surface.tsx";
import { clipboardReferenceFromPaste } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { composerStyles } from "./styles.stylex.ts";

export interface ComposerEditorHandle {
  readonly element: HTMLDivElement | null;
  focus(options?: FocusOptions): void;
  read(): ComposerSubmission;
  readDocument(): ComposerDocumentState;
  replaceText(start: number, end: number, text: string): void;
  insertReference(reference: MessageReference, start?: number, end?: number): void;
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
  /** Applied when it differs from the editor's last report; the parent's echoes never reseed. */
  readonly document: ComposerDocumentState;
  readonly onDocumentChange: (
    document: ComposerDocumentState,
    completion: ComposerCompletion | undefined,
  ) => void;
  readonly onReferencesChange?: (references: readonly MessageReference[]) => void;
  readonly files: readonly MentionFile[];
  readonly disabled: boolean;
  readonly autoFocus: boolean;
  readonly placeholder: string;
  /** Present when a suggestion popup can open: the editor is then its combobox. */
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

/**
 * Where a collapsed selection sits. Chromium reports no usable box beside a
 * chip: the trailing <br> after it has zero height at the baseline, and an
 * empty text node has no rect at all. The neighbours know the line instead.
 */
function caretBox(range: Range): CaretBox | undefined {
  const own = range.getClientRects()[0];

  if (own !== undefined && own.height > 0) return { x: own.left, top: own.top, height: own.height };
  const container = range.startContainer;
  const siblings = container instanceof Text ? [] : Array.from(container.childNodes);
  const before = siblings[range.startOffset - 1];
  const after = siblings[range.startOffset];

  if (before?.nodeName === "BR") {
    // After a line break the caret opens the next line at the block's start edge.
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

function sameReferences(
  left: readonly MessageReference[],
  right: readonly MessageReference[],
): boolean {
  return (
    left.length === right.length && left.every((reference, index) => reference === right[index])
  );
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
  autoFocus,
  placeholder,
  combobox,
  onKeyDown,
  onFocusChange,
  onFilesSelected,
}: ComposerEditorProps): ReactElement {
  const { editor, rootRef, decorators } = useComposerSurface(!disabled);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [empty, setEmpty] = useState(externalDocument.text === "");
  /** The last document this editor reported; the parent's copy of it is an echo, not an instruction. */
  const reported = useRef<ComposerDocumentState | undefined>(undefined);
  /** Includes composition updates whose parent report is deliberately deferred. */
  const observed = useRef<ComposerDocumentState | undefined>(undefined);
  const lastReferences = useRef<readonly MessageReference[]>([]);
  const referencesDirty = useRef(true);

  // Lexical's focus marks the selection dirty and commits it; the tag keeps
  // that commit from scrolling the caret into view.
  const focusEditor = useCallback(
    (options?: FocusOptions): void => {
      if (!editor.isEditable()) return;
      editor.update(
        () => {
          if (options?.preventScroll === true) $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
          editor.focus();
        },
        { discrete: true },
      );
    },
    [editor],
  );

  const handle = useMemo<ComposerEditorHandle>(
    () => ({
      get element() {
        return rootRef.current;
      },
      focus: focusEditor,
      read: () => editor.read($composerSubmission),
      readDocument: () =>
        editor.read(() => {
          const document = $readComposerDocument();
          observed.current = document;

          return document;
        }),
      replaceText(start, end, text) {
        focusEditor();
        editor.update(() => $replaceComposerText(start, end, text), {
          discrete: true,
          tag: HISTORY_PUSH_TAG,
        });
      },
      insertReference(reference, start, end) {
        focusEditor();
        editor.update(() => $insertComposerReference(reference, start, end), {
          discrete: true,
          tag: HISTORY_PUSH_TAG,
        });
      },
    }),
    [editor, focusEditor, rootRef],
  );

  useImperativeHandle(ref, () => handle, [handle]);
  useImperativeHandle(inputRef, () => handle, [handle]);

  useLayoutEffect(() => registerHistory(editor, createEmptyHistoryState(), 300), [editor]);

  useLayoutEffect(() => editor.setEditable(!disabled), [disabled, editor]);

  useLayoutEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        // Composition can mutate nodes before its final selection-only update.
        referencesDirty.current ||= dirtyElements.size > 0 || dirtyLeaves.size > 0;
        editorState.read(() => {
          const next = $readComposerDocument();
          observed.current = next;

          if (editor.isComposing()) return;

          if (referencesDirty.current) {
            referencesDirty.current = false;
            const references = $composerReferences();

            if (!sameReferences(references, lastReferences.current)) {
              lastReferences.current = references;
              onReferencesChange?.(references);
            }
          }

          const previous = reported.current;

          if (previous !== undefined && sameComposerDocument(previous, next)) return;
          reported.current = next;
          setEmpty(next.text === "");
          // A restore is the parent's own document coming back; it opens no menu.
          onDocumentChange(
            next,
            tags.has(COMPOSER_EXTERNAL_TAG) ? undefined : $composerCompletion(next.selectionStart),
          );
        });
      }),
    [editor, onDocumentChange, onReferencesChange],
  );

  useLayoutEffect(() => registerComposerReferences(editor, { files }), [editor, files]);

  useLayoutEffect(() => {
    const current = observed.current;

    if (current !== undefined && sameComposerDocument(current, externalDocument)) return;
    const root = rootRef.current;
    const focused = root !== null && root.ownerDocument.activeElement === root;
    editor.update(() => $restoreComposerDocument(externalDocument), {
      discrete: true,
      tag: focused ? HISTORY_MERGE_TAG : [HISTORY_MERGE_TAG, SKIP_DOM_SELECTION_TAG],
    });
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, externalDocument, rootRef]);

  useLayoutEffect(() => {
    if (autoFocus && !disabled) focusEditor();
  }, [autoFocus, disabled, focusEditor]);

  useLayoutEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.isComposing || editor.isComposing()) return false;
          onKeyDown(event);

          return event.defaultPrevented;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onKeyDown],
  );

  useLayoutEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const files = Array.from(event.clipboardData?.files ?? []);

          if (files.length > 0) {
            if (onFilesSelected === undefined) return false;
            event.preventDefault();
            onFilesSelected(files);

            return true;
          }

          const clipboard = clipboardReferenceFromPaste(
            event.clipboardData?.getData("text/plain") ?? "",
          );

          if (clipboard === undefined) return false;
          event.preventDefault();
          editor.update(() => $insertComposerReference(clipboard), {
            discrete: true,
            tag: HISTORY_PUSH_TAG,
          });

          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onFilesSelected],
  );

  // The drawn caret only mirrors the native selection. It never sets it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const caret = caretRef.current;

    if (root === null || caret === null) return;
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
          !editor.isComposing() &&
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
        // The invisible glyph measures the font, so the caret keeps its height on an empty line.
        const height = Math.min(glyph.getBoundingClientRect().height || lineHeight, lineHeight);
        const x = box.x - bounds.left;
        const y = box.top - bounds.top + Math.max(0, (box.height - height) / 2);
        // The native caret stays wherever Chromium reports no reliable box or the caret scrolled away.
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
      attributeFilter: ["class", "style", "data-theme"],
    });
    ownerDocument.fonts.addEventListener("loadingdone", draw);
    const unregister = editor.registerUpdateListener(draw);

    return () => {
      cancelAnimationFrame(frame);
      unregister();
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
  }, [editor, rootRef]);

  return (
    <div {...props(composerStyles.editorHost)}>
      <div
        ref={rootRef}
        className={className}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role={combobox === undefined ? "textbox" : "combobox"}
        aria-label={label}
        aria-multiline="true"
        aria-autocomplete={combobox === undefined ? undefined : "list"}
        aria-expanded={combobox?.expanded}
        aria-controls={combobox?.popupId}
        aria-activedescendant={combobox?.activeOption}
        aria-disabled={disabled}
        data-placeholder={placeholder}
        data-empty={empty}
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
      <ComposerDecorators
        editor={editor}
        decorators={decorators}
        onRemove={(key) => {
          editor.update(() => $getNodeByKey(key)?.remove(), {
            discrete: true,
            tag: HISTORY_PUSH_TAG,
          });
          focusEditor();
        }}
      />
    </div>
  );
}
