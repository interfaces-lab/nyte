import { defineRule } from "@oxlint/plugins";

import { readFunctionValue } from "../shared/function-value.ts";

import type { ESTree } from "@oxlint/plugins";

const IS_HELPER_NAME = /^is[A-Z0-9]/;

/**
 * Disallow `isFoo` helper functions: function declarations, named function expressions, function-valued
 * bindings, and private class methods. Public members and object-literal methods are left alone because an
 * external contract (Node's `Stats.isFile`, a plugin API) can dictate their names.
 */
export const noIsHelperNamesRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow `isFoo` helper functions; inline the condition where it is decided.",
    },
    messages: {
      isHelper:
        '"{{name}}" is an is* helper. Inline the condition at its call site so the decision reads in one place; if several sites share it, give the domain rule a name that says what it decides, not that it returns a boolean.',
    },
  },
  createOnce(context) {
    const reportName = (node: ESTree.Node, name: string) => {
      if (!IS_HELPER_NAME.test(name)) return;
      context.report({ node, messageId: "isHelper", data: { name } });
    };

    const reportPrivateMember = (node: ESTree.MethodDefinition | ESTree.PropertyDefinition) => {
      if (node.computed) return;
      if (node.key.type === "PrivateIdentifier") reportName(node.key, node.key.name);
      if (node.key.type === "Identifier" && node.accessibility === "private") {
        reportName(node.key, node.key.name);
      }
    };

    return {
      FunctionDeclaration(node) {
        if (node.id !== null) reportName(node.id, node.id.name);
      },
      FunctionExpression(node) {
        if (node.id === null) return;

        const binding = node.parent.type === "VariableDeclarator" ? node.parent.id : null;

        if (binding?.type === "Identifier" && binding.name === node.id.name) return;
        reportName(node.id, node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || readFunctionValue(node.init) === null) return;
        reportName(node.id, node.id.name);
      },
      MethodDefinition: reportPrivateMember,
      PropertyDefinition(node) {
        if (readFunctionValue(node.value) !== null) reportPrivateMember(node);
      },
    };
  },
});
