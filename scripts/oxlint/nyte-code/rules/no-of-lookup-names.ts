import { defineRule } from "@oxlint/plugins";

import {
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../../anti-slop/shared/function-parameters.ts";
import { readFunctionValue } from "../shared/function-value.ts";

import type { ESTree } from "@oxlint/plugins";

const OF_LOOKUP_NAME = /^[a-z][A-Za-z0-9]*[a-z0-9]Of$/;

/** Disallow `…Of` lookup names on functions, function-typed parameters, and function-valued members. */
export const noOfLookupNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow function names ending in "Of" (`keyOf`, `childOf`); name the operation or inline the expression.',
    },
    messages: {
      ofLookupName:
        'Rename "{{name}}" for the operation it performs (`findModel`, `readChild`, `formatRef`) or inline the expression; an "…Of" name hides how the value is found and how that can fail.',
    },
  },
  createOnce(context) {
    const reportOfLookupName = (node: ESTree.Node, name: string) => {
      if (!OF_LOOKUP_NAME.test(name)) return;
      context.report({ node, messageId: "ofLookupName", data: { name } });
    };

    const inspectFunction = (node: ESTree.ArrowFunctionExpression | ESTree.Function) => {
      if (node.id !== null) reportOfLookupName(node.id, node.id.name);

      for (const parameter of node.params) {
        if (functionParameterTypeAnnotation(parameter)?.typeAnnotation.type !== "TSFunctionType")
          continue;

        reportOfLookupName(parameter, functionParameterBindingName(parameter, context.sourceCode));
      }
    };

    const reportFunctionKey = (key: ESTree.PropertyKey, computed: boolean) => {
      if (!computed && (key.type === "Identifier" || key.type === "PrivateIdentifier")) {
        reportOfLookupName(key, key.name);
      }

      if (key.type === "Literal" && typeof key.value === "string") {
        reportOfLookupName(key, key.value);
      }
    };

    return {
      FunctionDeclaration: inspectFunction,
      FunctionExpression: inspectFunction,
      ArrowFunctionExpression: inspectFunction,
      TSDeclareFunction: inspectFunction,
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || readFunctionValue(node.init) === null) return;

        reportOfLookupName(node.id, node.id.name);
      },
      Property(node) {
        if (node.parent.type !== "ObjectExpression" || readFunctionValue(node.value) === null)
          return;
        reportFunctionKey(node.key, node.computed);
      },
      MethodDefinition(node) {
        reportFunctionKey(node.key, node.computed);
      },
      PropertyDefinition(node) {
        if (readFunctionValue(node.value) !== null) reportFunctionKey(node.key, node.computed);
      },
      AccessorProperty(node) {
        if (readFunctionValue(node.value) !== null) reportFunctionKey(node.key, node.computed);
      },
    };
  },
});
