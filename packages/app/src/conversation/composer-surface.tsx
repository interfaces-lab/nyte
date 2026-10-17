import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { useLayoutEffect, useState } from "react";
import { ComposerChipView } from "./composer-chip.tsx";
import {
  ComposerDocument,
  ComposerEditing,
  ComposerHardBreak,
  ComposerParagraph,
  ComposerReference,
  ComposerText,
  composerContent,
  composerReference,
  composerReferencesPlugin,
} from "./composer-document.ts";
import type { MentionFile } from "./message-references.ts";
import { openConversationLink } from "./external-link.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import type { ReferenceOpener } from "./reference-opener.tsx";
import { composerStyles } from "./composer.stylex.ts";

const URL_PATTERN =
  /((https?:\/\/(www\.)?)|(www\.))[-\p{L}\p{N}@:%._+~#=]{1,256}\.[\p{L}\p{N}]{1,6}(?:[-\p{L}\p{N}()@:%_+.~#?&//=]*[\p{L}\p{N}()@_~#?&//=])?/gu;

const URL_SEPARATOR = /[.,;\s]/u;

export const editorContentStyle = { display: "contents" } as const;

function balancedUrl(text: string): string {
  let depth = 0;

  for (const character of text) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
  }

  let url = text;

  while (depth < 0 && url.endsWith(")")) {
    url = url.slice(0, -1);
    depth += 1;
  }

  return url;
}

function linkDecorations(doc: ProseMirrorNode, className: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent, index) => {
    const text = node.text;

    if (text === undefined || parent === null) return;

    const lineEdge = (sibling: ProseMirrorNode | null): boolean =>
      sibling === null || sibling.type.name === ComposerHardBreak.name;

    for (const match of text.matchAll(URL_PATTERN)) {
      const url = balancedUrl(match[0]);
      const start = match.index;
      const end = start + url.length;

      const valid =
        (start > 0
          ? URL_SEPARATOR.test(text[start - 1] ?? "")
          : lineEdge(parent.maybeChild(index - 1))) &&
        (end < text.length
          ? URL_SEPARATOR.test(text[end] ?? "")
          : lineEdge(parent.maybeChild(index + 1)));

      if (valid) {
        decorations.push(
          Decoration.inline(pos + start, pos + end, {
            nodeName: "a",
            href: url.startsWith("http") ? url : `https://${url}`,
            class: className,
          }),
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

function composerLinks(): Plugin {
  const className = props(intent.primary, composerStyles.composerUrlPill).className ?? "";

  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => linkDecorations(state.doc, className),
      apply: (tr, links) => (tr.docChanged ? linkDecorations(tr.doc, className) : links),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

function registerComposerLinkClicks(
  root: HTMLElement,
  opener: ReferenceOpener | undefined,
): () => void {
  const intercept = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) return;
    const link = target.closest("a");

    if (link === null) return;
    event.preventDefault();
    openConversationLink(link.href, opener);
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) intercept(event);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && event.target instanceof HTMLAnchorElement) event.stopPropagation();
  };

  root.addEventListener("click", intercept);
  root.addEventListener("auxclick", onAuxClick);
  root.addEventListener("keydown", onKeyDown, true);

  return () => {
    root.removeEventListener("click", intercept);
    root.removeEventListener("auxclick", onAuxClick);
    root.removeEventListener("keydown", onKeyDown, true);
  };
}

export function focusComposer(editor: Editor, options?: FocusOptions): void {
  if (!editor.isEditable) return;
  editor.view.focus();

  if (options?.preventScroll !== true) editor.view.dispatch(editor.state.tr.scrollIntoView());
}

function ReferenceChip({
  node,
  editor,
  getPos,
  removable,
}: Pick<ReactNodeViewProps, "node" | "editor" | "getPos"> & { readonly removable: boolean }) {
  const reference = composerReference(node);

  const remove = (): void => {
    const pos = getPos();

    if (pos === undefined) return;
    editor.view.dispatch(closeHistory(editor.state.tr.delete(pos, pos + node.nodeSize)));
    focusComposer(editor);
  };

  return (
    <NodeViewWrapper as="span">
      {reference !== undefined && (
        <ComposerChipView reference={reference} onRemove={removable ? remove : undefined} />
      )}
    </NodeViewWrapper>
  );
}

/** Tiptap names every editor a textbox; a read-only message is text, and its row stays clickable. */
export function useComposerSurface({
  text,
  files,
  editable,
}: {
  readonly text: string;
  readonly files: () => ReadonlyMap<string, MentionFile>;
  readonly editable: boolean;
}): Editor {
  const opener = useReferenceOpener();

  const [options] = useState(() => {
    const chip = (nodeView: ReactNodeViewProps) => (
      <ReferenceChip {...nodeView} removable={editable} />
    );

    const surface = {
      extensions: [
        ComposerDocument,
        ComposerParagraph.configure({
          HTMLAttributes: { class: props(composerStyles.editorParagraph).className ?? "" },
        }),
        ComposerText,
        ComposerHardBreak,
        ComposerReference.extend({
          addNodeView: () =>
            ReactNodeViewRenderer(chip, {
              as: "span",
              attrs: ({ node }) => ({
                "data-composer-reference": composerReference(node)?.kind ?? "",
                style:
                  "display: inline-block; vertical-align: baseline; white-space: nowrap; max-width: 100%",
              }),
            }),
        }),
        Extension.create({
          name: "composerPlugins",
          addProseMirrorPlugins: () => [composerReferencesPlugin(files), composerLinks()],
        }),
        ...(editable ? [ComposerEditing] : []),
      ],
      content: composerContent(text, files()),
      injectCSS: false,
    };

    return editable
      ? surface
      : {
          ...surface,
          editable: false,
          editorProps: {
            attributes: {
              role: "",
              class: props(composerStyles.readOnly).className ?? "",
              "data-composer-readonly": "",
            },
          },
        };
  });

  const editor = useEditor(options);
  useLayoutEffect(() => registerComposerLinkClicks(editor.view.dom, opener), [editor, opener]);

  return editor;
}

const noFiles: ReadonlyMap<string, MentionFile> = new Map();

function ReadOnlyMessage({ draft }: { readonly draft: string }) {
  const editor = useComposerSurface({ text: draft, files: () => noFiles, editable: false });

  return <EditorContent editor={editor} style={editorContentStyle} />;
}

export function ComposerReadOnly({ text }: { readonly text: string }) {
  const draft = text.replaceAll(/\n{3,}/gu, "\n\n").replace(/^\n+|\n+$/gu, "");

  return <ReadOnlyMessage key={draft} draft={draft} />;
}
