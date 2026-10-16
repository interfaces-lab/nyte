import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const packageRoots = new Map<string, string | null>();

/** Find the directory of the nearest package.json at or above `path`; null outside every package. */
function findPackageRoot(path: string): string | null {
  const known = packageRoots.get(path);

  if (known !== undefined) return known;

  const parent = dirname(path);
  const root = existsSync(join(path, "package.json"))
    ? path
    : parent === path
      ? null
      : findPackageRoot(parent);

  packageRoots.set(path, root);
  return root;
}

/**
 * Disallow a relative import that lands in another package, such as `../../core/src/fold.ts`. A package is
 * reached through its name and `exports`, so its files can move without breaking callers and the import
 * graph matches the dependency graph in package.json.
 */
export const noCrossPackageRelativeImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow relative imports into another package; import it by name through its `exports`.",
    },
    messages: {
      crossPackage:
        '"{{source}}" reaches into the {{target}} package by relative path. Import it by package name through an `exports` entry, and add the dependency to package.json.',
    },
  },
  createOnce(context) {
    const inspectSource = (source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (!source.value.startsWith("./") && !source.value.startsWith("../")) return;

      const importer = findPackageRoot(dirname(context.filename));
      const target = findPackageRoot(resolve(dirname(context.filename), source.value));

      if (target === importer) return;
      context.report({
        node: source,
        messageId: "crossPackage",
        data: { source: source.value, target: target === null ? "(none)" : basename(target) },
      });
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
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          inspectSource(node.arguments[0]);
        }
      },
    };
  },
});
