import type { ESTree } from "@oxlint/plugins";

export type FunctionValue = ESTree.ArrowFunctionExpression | ESTree.Function;

export function readFunctionValue(node: ESTree.Node | null | undefined): FunctionValue | null {
  let current = node ?? null;

  while (current?.type === "ParenthesizedExpression" || current?.type === "TSSatisfiesExpression") {
    current = current.expression;
  }

  if (current?.type === "ArrowFunctionExpression" || current?.type === "FunctionExpression") {
    return current;
  }

  return null;
}
