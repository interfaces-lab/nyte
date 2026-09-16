import { props } from "@stylexjs/stylex";
import { AutoLinkNode, LinkNode, autoLinkUrlMatcher, registerAutoLink } from "@lexical/link";
import { registerPlainText } from "@lexical/plain-text";
import { createEditor, SKIP_DOM_SELECTION_TAG } from "lexical";
import type { LexicalEditor } from "lexical";
import { useLayoutEffect, useRef, useState } from "react";
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

type ComposerAutoLinkFollow = {
  readonly follow: boolean;
};

export function registerComposerAutoLink(
  editor: LexicalEditor,
  options: ComposerAutoLinkFollow,
): () => void {
  const unregisterAutoLink = registerAutoLink(editor, {
    matchers: [autoLinkUrlMatcher],
    changeHandlers: [],
    excludeParents: [
      (parent) => {
        const type = parent.getType();
        return type === ComposerReferenceNode.getType() || type === "code";
      },
    ],
  });
  const root = editor.getRootElement();
  if (root === null) return unregisterAutoLink;
  const intercept = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a");
    if (link === null) return;
    event.preventDefault();
    if (!options.follow) return;
    event.stopPropagation();
    const url = new URL(link.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      void nyte.host.openExternal({ url: url.href }).catch(() => undefined);
    }
  };
  const onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) intercept(event);
  };
  root.addEventListener("click", intercept);
  root.addEventListener("auxclick", onAuxClick);
  return () => {
    root.removeEventListener("click", intercept);
    root.removeEventListener("auxclick", onAuxClick);
    unregisterAutoLink();
  };
}

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
        link: props(
          editable ? composerStyles.composerUrlPill : composerStyles.messageLink,
        ).className,
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
    const links = registerComposerAutoLink(editor, { follow: !editable });
    const decorations = editor.registerDecoratorListener<MessageReference>(setDecorators);
    return () => {
      decorations();
      links();
      plainText();
      editor.setRootElement(null);
    };
  }, [editor, editable]);
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
  return (
    <>
      <div
        ref={rootRef}
        data-composer-readonly
        contentEditable={false}
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
