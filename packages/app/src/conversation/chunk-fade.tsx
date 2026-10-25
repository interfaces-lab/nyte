import { props } from "@stylexjs/stylex";
import { createContext, use, useState } from "react";
import type { ComponentProps, ReactElement } from "react";
import { Block, parseMarkdownIntoBlocks } from "streamdown";
import type { BlockProps, ExtraProps } from "streamdown";
import { FADE_MS, proseStyles } from "./prose.stylex.ts";

type HastElement = NonNullable<ExtraProps["node"]>;

type HastChild = HastElement["children"][number];

type HastParent = Pick<HastElement, "children">;

type RehypePlugins = NonNullable<BlockProps["rehypePlugins"]>;

type FadeInChunks = NonNullable<BlockProps["animatePlugin"]> & {
  readonly fadingPlugins: (plugins: RehypePlugins) => RehypePlugins;
  readonly endsFade: (node: HastElement | undefined) => boolean;
};

interface Commit {
  readonly offset: number;
  readonly at: number;
}

interface Faded {
  readonly element: HastElement;
  readonly start: number;
}

const NO_PLUGINS: RehypePlugins = [];

const UNFADED = new Set(["pre", "svg", "math", "annotation"]);

const FADED_WHOLE = new Set(["img", "hr"]);

const SPACE = /\s/u;

const BLANK = /^\s*$/u;

const FOOTNOTE = /\[\^[\w-]{1,200}\]/u;

const CHUNK_CLASSES = props(proseStyles.chunk).className?.split(" ");

let fadePlugins = 0;

export const StreamingTail = createContext(-1);

export const ReducedMotion = createContext(false);

export const FadeEnd = createContext<((node: HastElement | undefined) => void) | undefined>(
  undefined,
);

export function findStreamingTail(markdown: string): number {
  const blocks = parseMarkdownIntoBlocks(markdown);

  if (blocks.length === 1 && FOOTNOTE.test(markdown)) return -1;

  return blocks.findLastIndex((block, index) => index === 0 || !BLANK.test(block));
}

export function FadingBlock(block: BlockProps): ReactElement {
  const tail = use(StreamingTail) === block.index;
  const reducedMotion = use(ReducedMotion);
  const [fade] = useState(createFadeInChunks);
  const [wasTail, setWasTail] = useState(tail);
  const [retained, setRetained] = useState(false);
  const [quietContent, setQuietContent] = useState<string>();

  if (tail !== wasTail) {
    setWasTail(tail);

    if (!tail) setRetained(!reducedMotion && quietContent !== block.content);
  }

  const settle = (node: HastElement | undefined): void => {
    if (!fade.endsFade(node)) return;

    setQuietContent(block.content);
    setRetained(false);
  };

  return (
    <FadeEnd value={settle}>
      {tail || retained ? (
        <Block
          {...block}
          animatePlugin={fade}
          rehypePlugins={fade.fadingPlugins(block.rehypePlugins ?? NO_PLUGINS)}
        />
      ) : (
        <Block {...block} />
      )}
    </FadeEnd>
  );
}

export function FadeSpan({
  node,
  ...elementProps
}: ComponentProps<"span"> & ExtraProps): ReactElement {
  const settle = use(FadeEnd);

  return <span {...elementProps} onAnimationEnd={() => settle?.(node)} />;
}

function createFadeInChunks(): FadeInChunks {
  let commits: Commit[] = [{ offset: 0, at: Number.NEGATIVE_INFINITY }];
  let settled = 0;
  let committed = 0;
  let rendered = 0;
  let freshStart = 0;
  let faded: Faded[] = [];
  let newest = new WeakSet<HastElement>();
  let base: RehypePlugins | undefined;
  let plugins: RehypePlugins = [];

  const fadeStyle = (offset: number): string => `--sd-duration:${offset < settled ? 0 : FADE_MS}ms`;

  const chunk = (value: string, start: number): HastChild => {
    const element: HastElement = {
      type: "element",
      tagName: "span",
      properties: { "data-sd-animate": true, className: CHUNK_CLASSES, style: fadeStyle(start) },
      children: [{ type: "text", value }],
    };

    faded.push({ element, start });

    return element;
  };

  const splitText = (value: string, at: number): HastChild[] => {
    const cuts = new Set(
      commits.flatMap((commit) => {
        const cut = commit.offset - at;

        if (cut <= 0 || cut >= value.length) return [];

        const end = toSpace(value, cut);

        return end < value.length ? [end] : [];
      }),
    );

    const bounds = [0, ...cuts, value.length];

    return bounds.slice(1).map((end, index) => {
      const start = bounds[index] ?? 0;
      const piece = value.slice(start, end);

      return BLANK.test(piece) ? { type: "text", value: piece } : chunk(piece, at + start);
    });
  };

  const fadeInChunks = (tree: HastParent): void => {
    const cutoff = Date.now() - FADE_MS;
    settled = commits.findLast((commit) => commit.at <= cutoff)?.offset ?? 0;
    committed = commits.at(-1)?.offset ?? 0;
    faded = [];
    let offset = 0;

    const visit = (parent: HastParent): void => {
      parent.children = parent.children.flatMap((child): HastChild[] => {
        if (child.type === "text") {
          const pieces = splitText(child.value, offset);
          offset += child.value.length;

          return pieces;
        }

        if (child.type !== "element") return [child];

        if (FADED_WHOLE.has(child.tagName)) {
          child.properties = {
            ...child.properties,
            "data-sd-animate": true,
            style: fadeStyle(offset),
          };
          faded.push({ element: child, start: offset });
          offset += 1;
        } else if (!UNFADED.has(child.tagName)) visit(child);

        return [child];
      });
    };

    visit(tree);
    rendered = offset;

    if (faded.some((fade) => fade.start >= committed)) freshStart = committed;

    newest = new WeakSet(faded.flatMap((fade) => (fade.start >= freshStart ? [fade.element] : [])));
  };

  const rehypePlugin = Object.defineProperty(() => fadeInChunks, "name", {
    value: `rehypeFadeInChunks$${fadePlugins++}`,
  });

  return {
    name: "animate",
    type: "animate",
    rehypePlugin,
    commit() {
      if (rendered > (commits.at(-1)?.offset ?? 0))
        commits.push({ offset: rendered, at: Date.now() });
    },
    getLastRenderCharCount: () => rendered,
    setPrevContentLength(length) {
      commits = [{ offset: length, at: Number.NEGATIVE_INFINITY }];
    },
    fadingPlugins(next) {
      if (next !== base) {
        base = next;
        plugins = [...next, rehypePlugin];
      }

      return plugins;
    },
    endsFade: (node) => node !== undefined && newest.has(node),
  };
}

function toSpace(text: string, cut: number): number {
  if (SPACE.test(text.charAt(cut - 1)) || SPACE.test(text.charAt(cut))) return cut;

  const space = text.slice(cut).search(SPACE);

  return space === -1 ? text.length : cut + space;
}
