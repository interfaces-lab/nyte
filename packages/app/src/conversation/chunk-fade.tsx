import { props } from "@stylexjs/stylex";
import { createContext, use, useId, useLayoutEffect, useState } from "react";
import type { ReactElement } from "react";
import { Block } from "streamdown";
import type { BlockProps, ExtraProps } from "streamdown";
import { FLUSH_INTERVAL_MS } from "./paced-text.ts";
import { FADE_MS, proseStyles } from "./prose.stylex.ts";

type HastElement = NonNullable<ExtraProps["node"]>;

type HastChild = HastElement["children"][number];

type HastParent = Pick<HastElement, "children">;

type RehypePlugins = NonNullable<BlockProps["rehypePlugins"]>;

export const EnteringText = createContext<"plain" | "shown" | "new">("plain");

export const Resumes = createContext(0);

const SETTLE_MS = FADE_MS + 2 * FLUSH_INTERVAL_MS;

const WHOLE = new Set(["a", "code", "img"]);

const CHUNK_CLASSES = props(proseStyles.chunk).className?.split(" ");

export function FadingBlock(block: BlockProps): ReactElement {
  const entering = use(EnteringText);
  const parity = use(Resumes) % 2;
  const id = useId();

  const [fade] = useState(() =>
    createChunkFade(id, entering === "new", block.rehypePlugins ?? [], parity),
  );

  const [settled, setSettled] = useState(entering === "plain" ? block.content : undefined);
  const fading = block.content !== settled;

  useLayoutEffect(() => {
    if (fade.commit(parity) === 0 || !fading) return;

    const timer = setTimeout(() => {
      fade.settle();
      setSettled(block.content);
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [block.content, fade, fading, parity]);

  return <Block {...block} rehypePlugins={fading ? fade.lists[parity] : block.rehypePlugins} />;
}

function createChunkFade(id: string, fresh: boolean, base: RehypePlugins, parity: number) {
  let shown = fresh ? "" : undefined;
  let confirmed = parity;
  let start = 0;
  let ends: readonly number[] = [];
  let rendered = "";
  let ran = false;
  let pinned = false;

  const lists = [0, 1].map((side): RehypePlugins => {
    const fadeChunks = (tree: HastParent): void => {
      const text = readText(tree.children);
      const before = side === confirmed ? shown : undefined;
      const pin = before === undefined || !text.startsWith(before);
      rendered = text;
      ran = true;
      pinned = pin;

      if (pin) return;

      wrapChunks(tree, start, text.length > before.length ? [...ends, text.length] : ends);
    };

    return [
      ...base,
      Object.defineProperty(() => fadeChunks, "name", { value: `chunkFade${id}${side}` }),
    ];
  });

  return {
    lists,
    commit(side: number): number {
      confirmed = side;

      if (!ran) return ends.length;

      if (pinned || shown === undefined) {
        start = rendered.length;
        ends = [];
      } else if (rendered.length > shown.length) ends = [...ends, rendered.length];

      shown = rendered;
      ran = false;

      return ends.length;
    },
    settle(): void {
      start = rendered.length;
      ends = [];
    },
  };
}

function readText(children: readonly HastChild[]): string {
  return children
    .map((child) => {
      if (child.type === "text") return child.value;

      return child.type === "element" && child.tagName !== "pre" ? readText(child.children) : "";
    })
    .join("");
}

function wrapChunks(tree: HastParent, start: number, ends: readonly number[]): void {
  let offset = 0;

  const visit = (parent: HastParent): void => {
    parent.children = parent.children.flatMap((child): HastChild[] => {
      const at = offset;

      if (child.type === "text") {
        offset += child.value.length;

        return offset <= start ? [child] : splitText(child.value, at, start, ends);
      }

      if (child.type !== "element" || child.tagName === "pre") return [child];

      if (at >= start && WHOLE.has(child.tagName)) {
        offset += readText(child.children).length;

        return [chunkSpan([child])];
      }

      visit(child);

      return [child];
    });
  };

  visit(tree);
}

function splitText(value: string, at: number, start: number, ends: readonly number[]): HastChild[] {
  const end = at + value.length;
  const bounds = [at, ...[start, ...ends].filter((cut) => cut > at && cut < end), end];

  return bounds.slice(1).map((to, index): HastChild => {
    const piece = value.slice(bounds[index] - at, to - at);
    const text: HastChild = { type: "text", value: piece };

    return to <= start || piece.trim() === "" ? text : chunkSpan([text]);
  });
}

function chunkSpan(children: HastChild[]): HastChild {
  return { type: "element", tagName: "span", properties: { className: CHUNK_CLASSES }, children };
}
