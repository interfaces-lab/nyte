import { props } from "@stylexjs/stylex";
import { AutoLinkNode, LinkNode, autoLinkUrlMatcher, registerAutoLink } from "@lexical/link";
import { registerPlainText } from "@lexical/plain-text";
import { createEditor, SKIP_DOM_SELECTION_TAG } from "lexical";
import type { LexicalEditor } from "lexical";
import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ComposerChipView } from "./composer-chip.tsx";
import {
  $restoreComposerDocument,
  ComposerReferenceNode,
  registerComposerReferences,
} from "./composer-document.ts";
import { messageDraftText } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { nyte } from "../nyte.ts";
import { composerStyles } from "./styles.stylex.ts";

/** Both modes mount the same Lexical document and decorate the same reference nodes. */
export function useComposerSurface(editable: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [editor] = useState(() =>
    createEditor({
      namespace: "nyte-composer",
      editable,
      nodes: [ComposerReferenceNode, LinkNode, AutoLinkNode],
      theme: {
        paragraph: props(composerStyles.editorParagraph).className,
        link: props(composerStyles.messageLink).className,
      },
      onError: (error) => {
        throw error;
      },
    }),
  );
  const [decorators, setDecorators] = useState<Readonly<Record<string, MessageReference>>>({});
  useLayoutEffect(() => {
    editor.setRootElement(rootRef.current);
    const plainText = registerPlainText(editor);
    const decorations = editor.registerDecoratorListener<MessageReference>(setDecorators);
    return () => {
      decorations();
      plainText();
      editor.setRootElement(null);
    };
  }, [editor]);
  return { editor, rootRef, decorators };
}

export function ComposerDecorators({
  editor,
  decorators,
  onRemove,
}: {
  readonly editor: LexicalEditor;
  readonly decorators: Readonly<Record<string, MessageReference>>;
  readonly onRemove?: (key: string) => void;
}) {
  return Object.entries(decorators).map(([key, reference]) => {
    const element = editor.getElementByKey(key);
    return element === null
      ? null
      : createPortal(
          <ComposerChipView
            reference={reference}
            onRemove={onRemove === undefined ? undefined : () => onRemove(key)}
          />,
          element,
          key,
        );
  });
}

export function ComposerReadOnly({ text }: { readonly text: string }) {
  const { editor, rootRef, decorators } = useComposerSurface(false);
  useLayoutEffect(() => registerComposerReferences(editor, { files: [] }), [editor]);
  useLayoutEffect(
    () =>
      registerAutoLink(editor, {
        matchers: [autoLinkUrlMatcher],
        changeHandlers: [],
        excludeParents: [],
      }),
    [editor],
  );
  useLayoutEffect(() => {
    const draft = messageDraftText(text)
      .replaceAll(/\n{3,}/gu, "\n\n")
      .replace(/^\n+|\n+$/gu, "");
    editor.update(
      () => $restoreComposerDocument({ text: draft, selectionStart: 0, selectionEnd: 0 }),
      {
        discrete: true,
        tag: SKIP_DOM_SELECTION_TAG,
      },
    );
  }, [editor, text]);
  const openLink = (event: MouseEvent<HTMLDivElement>): void => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (link === null) return;
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(link.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      void nyte.host.openExternal({ url: url.href }).catch(() => undefined);
    }
  };
  return (
    <>
      <div
        ref={rootRef}
        data-composer-readonly
        contentEditable={false}
        onClick={openLink}
        onAuxClick={(event) => {
          if (event.button === 1) openLink(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLAnchorElement)
            event.stopPropagation();
        }}
        {...props(composerStyles.readOnly)}
      />
      <ComposerDecorators editor={editor} decorators={decorators} />
    </>
  );
}
