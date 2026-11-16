import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { BoxOptions, RenderContext, Renderable, TextOptions } from "@opentui/core";

/**
 * What a `"tui"` renderer draws: OpenTUI builds a renderable only against the context that shows
 * it, so the terminal client calls the view with its renderer.
 */
export type TuiView = (ctx: RenderContext) => Renderable;

export function box(options: BoxOptions, ...children: readonly TuiView[]): TuiView {
  return (ctx) => {
    const node = new BoxRenderable(ctx, options);

    for (const child of children) node.add(child(ctx));

    return node;
  };
}

export function text(options: TextOptions): TuiView {
  return (ctx) => new TextRenderable(ctx, options);
}
