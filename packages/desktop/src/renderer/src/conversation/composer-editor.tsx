import { props } from "@stylexjs/stylex";
import { createPortal } from "react-dom";
import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, Ref } from "react";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerPlainText } from "@lexical/plain-text";
import {
  $getNodeByKey,
  $getRoot,
  $isRangeSelection,
  $getSelection,
  createEditor,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  TextNode,
} from "lexical";
import type { MentionFile } from "@nyte-ai/core/views";
import type { ComposerChip } from "./composer.tsx";
import {
  $composerChips,
  $composerSelection,
  $fileMentionNodes,
  $insertComposerChip,
  $replaceComposerText,
  $selectComposerRange,
  $setComposerText,
  ComposerMentionNode,
} from "./composer-document.ts";
import { ComposerChipView } from "./composer-chip.tsx";
import { composerStyles } from "./styles.stylex.ts";

export interface ComposerEditorHandle {
  readonly element: HTMLDivElement | null;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus(options?: FocusOptions): void;
  clear(): void;
  setSelectionRange(start: number, end: number): void;
  replaceText(start: number, end: number, text: string): void;
  insertChip(chip: ComposerChip, start?: number, end?: number): void;
}

interface ComposerEditorProps {
  readonly ref: Ref<ComposerEditorHandle>;
  readonly inputRef?: (element: HTMLDivElement | null) => void;
  readonly className?: string;
  readonly value: string;
  readonly files: readonly MentionFile[];
  readonly disabled: boolean;
  readonly autoFocus: boolean;
  readonly placeholder: string;
  readonly expanded: boolean;
  readonly popupId: string | undefined;
  readonly activeOption: string | undefined;
  readonly onChange: (
    value: string,
    start: number,
    end: number,
    chips: readonly ComposerChip[],
  ) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly onFocusChange?: (focused: boolean) => void;
  readonly onFilesSelected?: (files: readonly File[]) => void;
}

/** Lexical owns editable DOM, selection, IME, clipboard and history; React owns the chips. */
export function ComposerEditor({
  ref,
  inputRef,
  className,
  value,
  files,
  disabled,
  autoFocus,
  placeholder,
  expanded,
  popupId,
  activeOption,
  onChange,
  onKeyDown,
  onFocusChange,
  onFilesSelected,
}: ComposerEditorProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [editor] = useState(() =>
    createEditor({
      namespace: "nyte-composer",
      nodes: [ComposerMentionNode],
      theme: { paragraph: props(composerStyles.editorParagraph).className },
      onError: (error) => {
        throw error;
      },
    }),
  );
  const [decorators, setDecorators] = useState<Readonly<Record<string, ComposerChip>>>({});

  useImperativeHandle(
    ref,
    () => ({
      get element() {
        return rootRef.current;
      },
      get selectionStart() {
        return editor.getEditorState().read(() => $composerSelection().start);
      },
      get selectionEnd() {
        return editor.getEditorState().read(() => $composerSelection().end);
      },
      focus(options) {
        rootRef.current?.focus(options);
      },
      clear() {
        editor.update(() => $setComposerText(""));
      },
      setSelectionRange(start, end) {
        editor.update(() => $selectComposerRange(start, end));
      },
      replaceText(start, end, text) {
        editor.update(() => $replaceComposerText(start, end, text), { tag: HISTORY_PUSH_TAG });
      },
      insertChip(chip, start, end) {
        editor.update(() => $insertComposerChip(chip, start, end), { tag: HISTORY_PUSH_TAG });
      },
    }),
    [editor],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    editor.setRootElement(root);
    inputRef?.(root);
    const plainText = registerPlainText(editor);
    const history = registerHistory(editor, createEmptyHistoryState(), 300);
    const decorations = editor.registerDecoratorListener<ComposerChip>(setDecorators);
    editor.update(() => {
      if ($getRoot().isEmpty()) $setComposerText("");
    });
    return () => {
      decorations();
      history();
      plainText();
      inputRef?.(null);
      editor.setRootElement(null);
    };
  }, [editor, inputRef]);

  useLayoutEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  useLayoutEffect(() => {
    if (autoFocus && !disabled) rootRef.current?.focus();
  }, [autoFocus, disabled]);

  useLayoutEffect(() => {
    if (editor.getEditorState().read(() => $getRoot().getTextContent()) === value) return;
    editor.update(() => $setComposerText(value), {
      tag: ["composer-external", SKIP_DOM_SELECTION_TAG],
    });
  }, [editor, value]);

  useLayoutEffect(() => {
    const byUrl = new Map(files.map((file) => [file.url, file]));
    const unregister = editor.registerNodeTransform(TextNode, (node) => {
      const nodes = $fileMentionNodes(node.getTextContent(), byUrl);
      if (!nodes.some((child) => child instanceof ComposerMentionNode)) return;
      const selection = $composerSelection();
      const first = nodes[0];
      if (first === undefined) return;
      node.replace(first);
      let previous = first;
      for (const next of nodes.slice(1)) {
        previous.insertAfter(next);
        previous = next;
      }
      if ($isRangeSelection($getSelection())) $selectComposerRange(selection.start, selection.end);
    });
    editor.update(() => {
      for (const node of $getRoot().getAllTextNodes()) node.markDirty();
    });
    return unregister;
  }, [editor, files]);

  useLayoutEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (tags.has("composer-external") || editor.isComposing()) return;
        editorState.read(() => {
          const selection = $composerSelection();
          onChange($getRoot().getTextContent(), selection.start, selection.end, $composerChips());
        });
      }),
    [editor, onChange],
  );

  useLayoutEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
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
          if (onFilesSelected === undefined || !(event instanceof ClipboardEvent)) return false;
          const attachments = Array.from(event.clipboardData?.files ?? []);
          if (attachments.length === 0) return false;
          event.preventDefault();
          onFilesSelected(attachments);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onFilesSelected],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    const caret = caretRef.current;
    if (root === null || caret === null) return;
    let frame = 0;
    const draw = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const visible =
          document.activeElement === root &&
          !editor.isComposing() &&
          selection?.isCollapsed === true &&
          selection.rangeCount > 0 &&
          root.contains(selection.anchorNode);
        const range = visible ? selection.getRangeAt(0) : undefined;
        const rect = range?.getClientRects()[0];
        const bounds = root.getBoundingClientRect();
        const lineHeight = Number.parseFloat(getComputedStyle(root).lineHeight);
        const height = rect?.height || lineHeight;
        const x = rect === undefined ? 0 : rect.left - bounds.left;
        const y = rect === undefined ? 0 : rect.top - bounds.top;
        const inView = visible && y >= 0 && y + height <= root.clientHeight + 1;
        caret.hidden = !inView;
        root.dataset.customCaret = String(inView);
        caret.style.transform = `translate(${x}px, ${y}px)`;
        caret.style.height = `${height}px`;
      });
    };
    document.addEventListener("selectionchange", draw);
    root.addEventListener("focus", draw);
    root.addEventListener("blur", draw);
    root.addEventListener("scroll", draw);
    root.addEventListener("compositionstart", draw);
    root.addEventListener("compositionend", draw);
    const observer = new ResizeObserver(draw);
    observer.observe(root);
    const unregister = editor.registerUpdateListener(draw);
    return () => {
      cancelAnimationFrame(frame);
      unregister();
      observer.disconnect();
      document.removeEventListener("selectionchange", draw);
      root.removeEventListener("focus", draw);
      root.removeEventListener("blur", draw);
      root.removeEventListener("scroll", draw);
      root.removeEventListener("compositionstart", draw);
      root.removeEventListener("compositionend", draw);
    };
  }, [editor]);

  return (
    <div {...props(composerStyles.editorHost)}>
      <div
        ref={rootRef}
        className={className}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="combobox"
        aria-label="Message"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={popupId}
        aria-activedescendant={activeOption}
        aria-disabled={disabled}
        data-placeholder={placeholder}
        data-empty={value === "" && Object.keys(decorators).length === 0}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
      />
      <span
        ref={caretRef}
        hidden
        aria-hidden="true"
        data-composer-caret=""
        {...props(composerStyles.editorCaret)}
      />
      {Object.entries(decorators).map(([key, chip]) => {
        const element = editor.getElementByKey(key);
        return element === null
          ? null
          : createPortal(
              <ComposerChipView
                chip={chip}
                disabled={disabled}
                onRemove={() => {
                  editor.update(
                    () => {
                      $getNodeByKey(key)?.remove();
                    },
                    { tag: HISTORY_PUSH_TAG },
                  );
                  editor.focus();
                }}
              />,
              element,
              key,
            );
      })}
    </div>
  );
}
