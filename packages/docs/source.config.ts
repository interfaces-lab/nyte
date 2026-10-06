import { defineConfig } from "fumadocs-mdx/config";
import { rehypeCodeDefaultOptions, remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { model, modelId } from "./src/lib/shared";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

function fillModel(node: MarkdownNode) {
  if ((node.type === "code" || node.type === "inlineCode") && node.value !== undefined)
    node.value = node.value.replaceAll("{{model}}", model).replaceAll("{{modelId}}", modelId);
  for (const child of node.children ?? []) fillModel(child);
}

const remarkModel = () => fillModel;

/*
 * The collection lives in `src/lib/docs.ts` via the `fumadocs-mdx/macro` API. This
 * file exists only for global MDX options, which the macro collections inherit.
 *
 * Setting `mdxOptions` on a collection would drop the default plugin set;
 * setting it here merges with the `fumadocs` preset instead, so `remarkGfm`,
 * `rehypeCode`, and the rest stay in place.
 */
export default defineConfig({
  mdxOptions: {
    // ```mermaid → <Mermaid />, resolved from src/components/mdx.tsx. {{model}} and
    // {{modelId}} in code → the site's model, from src/lib/shared.ts.
    remarkPlugins: (plugins) => [remarkModel, remarkMdxMermaid, ...plugins],
    // Dual-theme Shiki tokens (`--shiki-light` / `--shiki-dark`) plus the
    // default notation transformers and language icons on titled blocks.
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    },
  },
});
