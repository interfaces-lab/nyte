import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const COMPARISONS = new Set(["===", "!==", "==", "!="]);

function readsWindowApp(node: ESTree.Node): boolean {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "windowApp"
  );
}

export const noAppIdentityRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow branching on which app the window is; each difference between the apps is a field of AppShape.",
    },
    messages: {
      identity:
        "Don't branch on which app the window is. Add the fact to AppShape and read it with appShape(), so every difference between the apps sits in one row.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (!COMPARISONS.has(node.operator)) return;

        const literal =
          (readsWindowApp(node.left) && node.right.type === "Literal") ||
          (readsWindowApp(node.right) && node.left.type === "Literal");

        if (literal) context.report({ node, messageId: "identity" });
      },
      SwitchStatement(node) {
        if (readsWindowApp(node.discriminant)) {
          context.report({ node: node.discriminant, messageId: "identity" });
        }
      },
    };
  },
});
