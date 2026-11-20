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

/**
 * Setting `mdxOptions` on a collection would drop the default plugin set;
 * setting it here merges with the `fumadocs` preset instead, so `remarkGfm`,
 * `rehypeCode`, and the rest stay in place.
 */
export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkModel, remarkMdxMermaid, ...plugins],
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
