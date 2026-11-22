import { intent } from "@nyte-ai/ui/surface-theme";
import { defaultMarker, props } from "@stylexjs/stylex";
import { Editor, Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { EditorContentProps, ReactNodeViewProps } from "@tiptap/react";
import { useLayoutEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";
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
} from "../../panes/composer-document.ts";
import type { MentionFile } from "../../data/files.ts";
import { openConversationLink } from "../../markdown/external-link.ts";
import { messageParts } from "../../references/message-references.ts";
import { useReferenceOpener } from "../../references/reference-opener.tsx";
import type { ReferenceOpener } from "../../references/reference-opener.tsx";
import { composerStyles } from "./composer.stylex.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

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

interface UrlRange {
  readonly start: number;
  readonly end: number;
  readonly href: string;
}

function urlRanges(text: string, startsLine: boolean, endsLine: boolean): readonly UrlRange[] {
  return [...text.matchAll(URL_PATTERN)].flatMap((match) => {
    const url = balancedUrl(match[0]);
    const start = match.index;
    const end = start + url.length;

    const valid =
      (start > 0 ? URL_SEPARATOR.test(text[start - 1] ?? "") : startsLine) &&
      (end < text.length ? URL_SEPARATOR.test(text[end] ?? "") : endsLine);

    return valid ? [{ start, end, href: url.startsWith("http") ? url : `https://${url}` }] : [];
  });
}

function linkDecorations(doc: ProseMirrorNode, className: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent, index) => {
    const text = node.text;

    if (text === undefined || parent === null) return;

    const lineEdge = (sibling: ProseMirrorNode | null): boolean =>
      sibling === null || sibling.type.name === ComposerHardBreak.name;

    for (const range of urlRanges(
      text,
      lineEdge(parent.maybeChild(index - 1)),
      lineEdge(parent.maybeChild(index + 1)),
    )) {
      decorations.push(
        Decoration.inline(pos + range.start, pos + range.end, {
          nodeName: "a",
          href: range.href,
          class: className,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

const LINK_CLASS = props(intent.primary, composerStyles.composerUrlPill).className ?? "";

function composerLinks(): Plugin {
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => linkDecorations(state.doc, LINK_CLASS),
      apply: (tr, links) => (tr.docChanged ? linkDecorations(tr.doc, LINK_CLASS) : links),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

const SELECTED_MARKER = props(defaultMarker()).className ?? "";

function selectedReferences(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const selection = state.selection;

        if (selection.empty) return DecorationSet.empty;
        const decorations: Decoration[] = [];
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (
            composerReference(node) !== undefined &&
            pos >= selection.from &&
            pos + node.nodeSize <= selection.to
          ) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                "data-composer-selected": "",
                class: SELECTED_MARKER,
              }),
            );
          }
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function composerLinkHandlers(opener: ReferenceOpener | undefined) {
  const intercept = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) return;
    const link = target.closest("a");

    if (link === null) return;
    event.preventDefault();
    openConversationLink(link.href, opener);
  };

  return {
    onClick: intercept,
    onAuxClick: (event: MouseEvent): void => {
      if (event.button === 1) intercept(event);
    },
    onKeyDownCapture: (event: KeyboardEvent): void => {
      if (event.key === "Enter" && event.target instanceof HTMLAnchorElement) {
        event.stopPropagation();
      }
    },
  };
}

export function editorRoot(editor: Editor): HTMLElement | null {
  return editor.isDestroyed ? null : editor.view.dom;
}

export function focusComposer(editor: Editor, options?: FocusOptions): void {
  if (!editor.isEditable) return;
  editor.view.focus();

  if (options?.preventScroll !== true) editor.view.dispatch(editor.state.tr.scrollIntoView());
}

function ReferenceChip({ node, editor, getPos }: ReactNodeViewProps) {
  const reference = composerReference(node);

  const remove = (): void => {
    const pos = getPos();

    if (pos === undefined) return;
    editor.view.dispatch(closeHistory(editor.state.tr.delete(pos, pos + node.nodeSize)));
    focusComposer(editor);
  };

  return (
    <NodeViewWrapper as="span">
      {reference !== undefined && <ComposerChipView reference={reference} onRemove={remove} />}
    </NodeViewWrapper>
  );
}

export function useComposerSurface({
  text,
  files,
}: {
  readonly text: string;
  readonly files: () => ReadonlyMap<string, MentionFile>;
}): Editor {
  const [editor] = useState(
    () =>
      new Editor({
        extensions: [
          ComposerDocument,
          ComposerParagraph.configure({
            HTMLAttributes: { class: props(composerStyles.editorParagraph).className ?? "" },
          }),
          ComposerText,
          ComposerHardBreak,
          ComposerReference.extend({
            addNodeView: () =>
              ReactNodeViewRenderer(ReferenceChip, {
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
            addProseMirrorPlugins: () => [
              composerReferencesPlugin(files),
              composerLinks(),
              selectedReferences(),
            ],
          }),
          ComposerEditing,
        ],
        content: composerContent(text, files()),
        injectCSS: false,
      }),
  );

  return editor;
}

function EditorViewLifetime({ editor }: { readonly editor: Editor }): null {
  // oxlint-disable-next-line nyte-code/no-direct-effect -- remounts a reused, destroyed Tiptap view before paint
  useLayoutEffect(() => {
    if (editor.isDestroyed) editor.mount(document.createElement("div"));
  }, [editor]);
  useMountEffect(() => () => editor.unmount());

  return null;
}

export function ComposerSurfaceContent({
  editor,
  ...content
}: Omit<EditorContentProps, "editor" | "ref"> & { readonly editor: Editor }): ReactElement {
  const opener = useReferenceOpener();

  return (
    <>
      <EditorViewLifetime editor={editor} />
      <EditorContent editor={editor} {...content} {...composerLinkHandlers(opener)} />
    </>
  );
}

const noFiles: ReadonlyMap<string, MentionFile> = new Map();

const REFERENCE_STYLE = {
  display: "inline-block",
  verticalAlign: "baseline",
  whiteSpace: "nowrap",
  maxWidth: "100%",
} as const;

function LinkedText({
  text,
  startsLine,
  endsLine,
}: {
  readonly text: string;
  readonly startsLine: boolean;
  readonly endsLine: boolean;
}): ReactNode {
  const ranges = urlRanges(text, startsLine, endsLine);

  if (ranges.length === 0) return text;

  return ranges.flatMap((range, index) => [
    text.slice(ranges[index - 1]?.end ?? 0, range.start),
    <a key={range.start} href={range.href} className={LINK_CLASS}>
      {text.slice(range.start, range.end)}
    </a>,
    ...(index === ranges.length - 1 ? [text.slice(range.end)] : []),
  ]);
}

function ReadOnlyMessage({ draft }: { readonly draft: string }): ReactElement {
  const opener = useReferenceOpener();

  const lines = draft
    .split(/\r?\n/u)
    .map((line) => messageParts(line, { files: noFiles, complete: true }));

  return (
    <div style={editorContentStyle} {...composerLinkHandlers(opener)}>
      <div
        contentEditable={false}
        translate="no"
        data-composer-readonly=""
        {...props(composerStyles.readOnly)}
      >
        <p {...props(composerStyles.editorParagraph)}>
          {lines.flatMap((parts, line) => [
            ...(line === 0 ? [] : [<br key={`${String(line)}:break`} />]),
            ...parts.map((part, index) =>
              part.kind === "text" ? (
                <LinkedText
                  key={`${String(line)}:${String(index)}`}
                  text={part.text}
                  startsLine={index === 0}
                  endsLine={index === parts.length - 1}
                />
              ) : (
                <span
                  key={`${String(line)}:${String(index)}`}
                  data-composer-reference={part.reference.kind}
                  style={REFERENCE_STYLE}
                >
                  <span data-node-view-wrapper="" style={{ whiteSpace: "normal" }}>
                    <ComposerChipView reference={part.reference} />
                  </span>
                </span>
              ),
            ),
          ])}
        </p>
      </div>
    </div>
  );
}

export function ComposerReadOnly({ text }: { readonly text: string }) {
  const draft = text.replaceAll(/\n{3,}/gu, "\n\n").replaceAll(/^\n+|\n+$/gu, "");

  return <ReadOnlyMessage draft={draft} />;
}
