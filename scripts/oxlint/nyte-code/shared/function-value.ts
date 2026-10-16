import type { ESTree } from "@oxlint/plugins";

/** A function written as a value: an arrow or a function expression. */
export type FunctionValue = ESTree.ArrowFunctionExpression | ESTree.Function;

/** Read the function a binding holds, looking through parentheses and `satisfies`; null when the value is not a function. */
export function readFunctionValue(
  node: ESTree.Expression | null | undefined,
): FunctionValue | null {
  let current = node ?? null;

  while (current?.type === "ParenthesizedExpression" || current?.type === "TSSatisfiesExpression") {
    current = current.expression;
  }

  if (current?.type === "ArrowFunctionExpression" || current?.type === "FunctionExpression") {
    return current;
  }

  return null;
}
