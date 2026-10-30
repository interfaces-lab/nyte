import { create, props } from "@stylexjs/stylex";
import { Editor, Extension } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { intent } from "@nyte-ai/ui/surface-theme";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { openConversationLink } from "../../chat/markdown/external-link.ts";
import type { HighlightToken } from "../../chat/markdown/highlight-code.ts";
import { MermaidDiagram } from "../../chat/markdown/mermaid-diagram.tsx";
import { codeBlockStyles, proseStyles } from "../../chat/markdown/prose.stylex.ts";
import { workspaceFiles } from "../../data/files.ts";
import { loadDeferred } from "../../lib/deferred.tsx";
import { useBlobUrl } from "../../lib/use-blob-url.ts";
import { fileFromUrl } from "../../references/message-references.ts";
import { conversation } from "../../theme/schema.stylex.ts";
import { workbenchReferenceOpener } from "../commands.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { parseMarkdown, readFrontmatter } from "./markdown-parse.ts";
import {
  MarkdownCodeBlock,
  MarkdownImage,
  MarkdownLink,
  markdownExtensions,
} from "./markdown-schema.ts";
import { markdownOrigin, serializeMarkdown } from "./markdown-serialize.ts";
import { markdownStyles } from "./markdown.stylex.ts";

/** The source editor edits the same buffer. */
interface MarkdownBuffer {
  readonly getSnapshot: () => { readonly contents: string };
  readonly subscribe: (listener: () => void) => () => void;
  readonly edit: (contents: string) => void;
}

interface MarkdownDocumentProps {
  readonly buffer: MarkdownBuffer;
  /** The file's absolute path, which relative links and images resolve against. */
  readonly path: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly viewKey: WorkbenchViewKey;
}

type HighlightLines = readonly (readonly HighlightToken[])[];

const styles = create({
  scroll: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    scrollbarGutter: "stable",
  },
  column: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: conversation.measure,
    marginInline: "auto",
    paddingBlock: space.s6,
    paddingInline: space.s6,
  },
  editor: {
    outlineStyle: "none",
    whiteSpace: "pre-wrap",
    caretColor: role.contentPrimary,
  },
  properties: {
    display: "grid",
    gridTemplateColumns: "minmax(min-content, max-content) 1fr",
    columnGap: space.s4,
    rowGap: space.s1,
    marginBlockEnd: space.s5,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  property: { display: "contents" },
  propertyKey: { color: role.contentSecondary },
  propertyValue: {
    margin: 0,
    minWidth: 0,
    color: role.contentPrimary,
    overflowWrap: "anywhere",
  },
  diagram: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1 },
  fill: { width: "100%" },
  image: { maxWidth: "100%", borderRadius: radius.control, verticalAlign: "middle" },
  imageLabel: { color: role.contentSecondary, fontFamily: type.fontSans },
});

export function MarkdownDocument(input: MarkdownDocumentProps): ReactElement {
  const [session] = useState(() => createMarkdownSession(input));

  const contents = useSyncExternalStore(
    input.buffer.subscribe,
    () => input.buffer.getSnapshot().contents,
  );

  const frontmatter = readFrontmatter(contents);

  useMountEffect(session.connect);

  return (
    <div data-nyte-scrollport {...props(styles.scroll)}>
      <div {...props(text.base, styles.column)}>
        {frontmatter !== undefined && frontmatter.length > 0 && (
          <dl aria-label="Properties" {...props(text.sm, styles.properties)}>
            {frontmatter.map(([key, value]) => (
              <div key={key} {...props(styles.property)}>
                <dt {...props(styles.propertyKey)}>{key}</dt>
                <dd {...props(styles.propertyValue)}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <EditorContent editor={session.editor} onClick={session.click} />
      </div>
    </div>
  );
}

function createMarkdownSession(input: MarkdownDocumentProps) {
  const parsed = parseMarkdown(input.buffer.getSnapshot().contents);
  let written = input.buffer.getSnapshot().contents;
  const base = new URL("file:///");
  base.pathname = input.path;

  const editor = new Editor({
    extensions: documentExtensions(base.href),
    content: parsed.content,
    editable: !input.readOnly,
    injectCSS: false,
    editorProps: {
      attributes: {
        "aria-label": input.label,
        "aria-multiline": "true",
        "aria-readonly": String(input.readOnly),
        class: props(proseStyles.root, styles.editor).className ?? "",
      },
    },
    onUpdate: ({ editor: current }) => {
      written = serializeMarkdown(current.state.doc, origin);
      input.buffer.edit(written);
    },
  });

  let origin = markdownOrigin(editor.state.doc, parsed.layout);

  const reload = (): void => {
    const contents = input.buffer.getSnapshot().contents;

    if (contents === written) return;
    written = contents;
    const next = parseMarkdown(contents);
    const doc = editor.schema.nodeFromJSON(next.content);
    editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
    origin = markdownOrigin(doc, next.layout);
  };

  const opener = workbenchReferenceOpener(input.viewKey);

  return {
    editor,
    connect: () => {
      const unsubscribe = input.buffer.subscribe(reload);

      return () => {
        unsubscribe();
        editor.destroy();
      };
    },
    click: (event: MouseEvent<HTMLDivElement>): void => {
      const target = event.target;
      const link = target instanceof Element ? target.closest("a[href]") : null;

      if (link === null) return;
      event.preventDefault();

      if (editor.isEditable && !(event.metaKey || event.ctrlKey)) return;
      const href = link.getAttribute("href") ?? "";

      if (/^[a-z][a-z\d+.-]*:/iu.test(href) && !href.startsWith("file:")) {
        openConversationLink(href, opener);

        return;
      }

      const file = workspaceFile(href, base.href);

      if (file !== undefined) opener({ kind: "file", file })?.();
    },
  };
}

function workspaceFile(href: string, base: string) {
  const url = href.startsWith("#") ? null : URL.parse(href, base);

  if (url === null) return undefined;
  url.hash = "";
  url.search = "";

  return fileFromUrl(url.href);
}

function documentExtensions(base: string): Extensions {
  const views: Extensions = [
    MarkdownCodeBlock.extend({
      addNodeView: () => ReactNodeViewRenderer(CodeBlockView, { as: "div" }),
    }),
    MarkdownImage.extend({
      addNodeView: () =>
        ReactNodeViewRenderer((view: ReactNodeViewProps) => <ImageView {...view} base={base} />, {
          as: "span",
        }),
    }),
    MarkdownLink.extend({
      renderHTML: ({ mark }) => [
        "a",
        {
          href: String(mark.attrs["href"]),
          title: String(mark.attrs["href"]),
          class: props(intent.primary, proseStyles.link, proseStyles.webLink).className ?? "",
        },
        0,
      ],
    }),
    Extension.create({
      name: "markdownHighlight",
      addProseMirrorPlugins: () => [codeHighlighting()],
    }),
  ];

  const replaced = new Set(views.map((extension) => extension.name));

  return [...markdownExtensions.filter((extension) => !replaced.has(extension.name)), ...views];
}

function codeLanguage(node: ProseMirrorNode): string {
  return (
    String(node.attrs["info"] ?? "")
      .trim()
      .toLowerCase()
      .split(/\s+/u)[0] ?? ""
  );
}

function CodeBlockView(view: ReactNodeViewProps): ReactElement {
  const [editing, setEditing] = useState(false);

  const code = (
    <figure {...props(codeBlockStyles.figure)}>
      <div data-nyte-scrollport {...props(codeBlockStyles.scroll)}>
        <pre data-nyte-code {...props(text.code, codeBlockStyles.pre, markdownStyles.pre)}>
          <NodeViewContent<"code"> as="code" />
        </pre>
      </div>
    </figure>
  );

  if (codeLanguage(view.node) !== "mermaid") return <NodeViewWrapper>{code}</NodeViewWrapper>;
  const sourceShown = editing || view.selectionInside === true;

  return (
    <NodeViewWrapper {...props(styles.diagram)}>
      <div contentEditable={false} {...props(styles.fill)}>
        <MermaidDiagram source={view.node.textContent} />
      </div>
      {view.editor.isEditable && (
        <div contentEditable={false}>
          <Button size="sm" onClick={() => setEditing(!sourceShown)}>
            {sourceShown ? "Hide Diagram Source" : "Edit Diagram"}
          </Button>
        </div>
      )}
      <div hidden={!sourceShown} {...props(styles.fill)}>
        {code}
      </div>
    </NodeViewWrapper>
  );
}

function ImageView(view: ReactNodeViewProps & { readonly base: string }): ReactElement {
  const source = String(view.node.attrs["src"] ?? "");
  const alt = String(view.node.attrs["alt"] ?? "");
  const local = /^[a-z][a-z\d+.-]*:/iu.test(source) ? undefined : workspaceFile(source, view.base);

  return (
    <NodeViewWrapper as="span">
      {source.startsWith("data:image/") ? (
        <img src={source} alt={alt} {...props(styles.image)} />
      ) : local === undefined ? (
        <span {...props(styles.imageLabel)}>{alt || source}</span>
      ) : (
        <WorkspaceImage path={local.path} alt={alt} />
      )}
    </NodeViewWrapper>
  );
}

function WorkspaceImage(input: { readonly path: string; readonly alt: string }): ReactElement {
  const path = input.path;
  const url = useBlobUrl(["files", "bytes", path], async () =>
    (await workspaceFiles()).bytes(path),
  );

  if (url.data === undefined)
    return <span {...props(styles.imageLabel)}>{input.alt || path.split("/").at(-1)}</span>;

  return <img src={url.data} alt={input.alt} {...props(styles.image)} />;
}

const highlightKey = new PluginKey<DecorationSet>("markdownHighlight");

function codeHighlighting(): Plugin<DecorationSet> {
  const cache = new Map<string, HighlightLines | null>();
  let view: EditorView | undefined;

  const request = (id: string, code: string, language: string): void => {
    cache.set(id, null);
    void loadDeferred("highlight").then((runtime) => {
      cache.set(id, runtime.highlightTokens(code, language) ?? []);

      if (view !== undefined && !view.isDestroyed)
        view.dispatch(view.state.tr.setMeta(highlightKey, true));
    });
  };

  const decorate = (doc: ProseMirrorNode, previous: DecorationSet): DecorationSet => {
    const decorations: Decoration[] = [];
    const used = new Set<string>();

    doc.descendants((node, position) => {
      if (node.type.name !== "codeBlock") return true;
      const language = codeLanguage(node);

      if (language === "" || language === "mermaid") return false;
      const id = `${language}\0${node.textContent}`;
      const lines = cache.get(id);
      used.add(id);

      if (lines === undefined) request(id, node.textContent, language);

      if (lines === undefined || lines === null) {
        decorations.push(...previous.find(position, position + node.nodeSize));

        return false;
      }

      let offset = position + 1;

      for (const line of lines) {
        for (const token of line) {
          const end = offset + token.content.length;

          if (token.style !== "")
            decorations.push(Decoration.inline(offset, end, { style: token.style }));
          offset = end;
        }

        offset += 1;
      }

      return false;
    });

    for (const id of cache.keys()) if (!used.has(id)) cache.delete(id);

    return DecorationSet.create(doc, decorations);
  };

  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_, state) => decorate(state.doc, DecorationSet.empty),
      apply: (transaction, previous) =>
        transaction.docChanged || transaction.getMeta(highlightKey) === true
          ? decorate(transaction.doc, previous.map(transaction.mapping, transaction.doc))
          : previous,
    },
    view: (editorView) => {
      view = editorView;

      return {};
    },
    props: {
      decorations(state) {
        return highlightKey.getState(state);
      },
    },
  });
}
