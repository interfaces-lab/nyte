import { defineRule } from "@oxlint/plugins";

import { readFunctionValue } from "../shared/function-value.ts";

import type { ESTree, Variable } from "@oxlint/plugins";
import type { FunctionValue } from "../shared/function-value.ts";

const COMPARISON_OPERATORS = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "instanceof",
]);

const BOOLEAN_METHODS = new Set([
  "every",
  "endsWith",
  "has",
  "includes",
  "isArray",
  "isFinite",
  "isInteger",
  "isNaN",
  "isSafeInteger",
  "some",
  "startsWith",
  "test",
]);

/** Read the one expression a function body returns; null when the body is more than `return <expression>`. */
function readSingleExpression(fn: FunctionValue): ESTree.Expression | null {
  if (fn.body === null) return null;
  if (fn.body.type !== "BlockStatement") return fn.body;

  const [statement, ...rest] = fn.body.body;

  if (rest.length > 0 || statement?.type !== "ReturnStatement") return null;
  return statement.argument;
}

/** Decide from syntax alone whether an expression evaluates to a boolean. */
function readsAsBoolean(expression: ESTree.Expression): boolean {
  switch (expression.type) {
    case "ParenthesizedExpression":
      return readsAsBoolean(expression.expression);
    case "Literal":
      return typeof expression.value === "boolean";
    case "UnaryExpression":
      return expression.operator === "!";
    case "BinaryExpression":
      return COMPARISON_OPERATORS.has(expression.operator);
    case "LogicalExpression":
      return (
        expression.operator !== "??" &&
        readsAsBoolean(expression.left) &&
        readsAsBoolean(expression.right)
      );
    case "ConditionalExpression":
      return readsAsBoolean(expression.consequent) && readsAsBoolean(expression.alternate);
    case "CallExpression":
      return (
        expression.callee.type === "MemberExpression" &&
        expression.callee.property.type === "Identifier" &&
        BOOLEAN_METHODS.has(expression.callee.property.name)
      );
    default:
      return false;
  }
}

function returnsBoolean(fn: FunctionValue, expression: ESTree.Expression): boolean {
  const returnType = fn.returnType?.typeAnnotation;

  if (returnType === undefined) return readsAsBoolean(expression);
  if (returnType.type === "TSTypePredicate") return !returnType.asserts;
  return returnType.type === "TSBooleanKeyword";
}

/** Find the one call site of a helper; null when it is read anywhere else or more than once. */
function findOnlyCall(variable: Variable, fn: FunctionValue): ESTree.Node | null {
  const reads = variable.references.filter((reference) => reference.isRead());

  if (reads.length !== 1) return null;

  const [read] = reads;
  const call = read.identifier.parent;

  if (read.identifier.start >= fn.start && read.identifier.end <= fn.end) return null;
  if (call.type !== "CallExpression" || call.callee !== read.identifier) return null;
  return call;
}

/**
 * Disallow a non-exported helper whose body is one boolean expression and that is called from exactly one
 * place in the file. Inlining it keeps the condition in the chain that uses it.
 */
export const noOneOffBooleanHelpersRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow single-expression boolean helpers that are called from exactly one site in the same file.",
    },
    messages: {
      oneOff:
        '"{{name}}" is a one-expression boolean helper with a single call site. Inline the expression where it is called so the condition stays in the chain that uses it.',
    },
  },
  createOnce(context) {
    const inspect = (declaration: ESTree.Node, name: string, fn: FunctionValue) => {
      if (fn.async || fn.generator) return;

      const expression = readSingleExpression(fn);

      if (expression === null || !returnsBoolean(fn, expression)) return;

      const [variable] = context.sourceCode.getDeclaredVariables(declaration);

      if (variable === undefined || findOnlyCall(variable, fn) === null) return;
      context.report({ node: declaration, messageId: "oneOff", data: { name } });
    };

    return {
      FunctionDeclaration(node) {
        if (node.id === null || node.parent.type === "ExportNamedDeclaration") return;
        if (node.parent.type === "ExportDefaultDeclaration") return;
        inspect(node, node.id.name, node);
      },
      VariableDeclarator(node) {
        const fn = readFunctionValue(node.init);

        if (fn === null || node.id.type !== "Identifier") return;
        if (node.parent.parent?.type === "ExportNamedDeclaration") return;
        inspect(node, node.id.name, fn);
      },
    };
  },
});
