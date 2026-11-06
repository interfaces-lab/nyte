import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

export const noLabImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow importing @nyte-ai/lab; the lab is never a dependency." },
    messages: {
      lab: '"{{source}}" imports the lab. Nothing depends on the lab: move what you need into the package that owns it, and import it from there.',
    },
  },
  createOnce(context) {
    const inspectSource = (source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (source.value !== "@nyte-ai/lab" && !source.value.startsWith("@nyte-ai/lab/")) return;
      context.report({ node: source, messageId: "lab", data: { source: source.value } });
    };

    return {
      ImportDeclaration(node) {
        inspectSource(node.source);
      },
      ExportAllDeclaration(node) {
        inspectSource(node.source);
      },
      ExportNamedDeclaration(node) {
        inspectSource(node.source);
      },
      ImportExpression(node) {
        inspectSource(node.source);
      },
    };
  },
});
