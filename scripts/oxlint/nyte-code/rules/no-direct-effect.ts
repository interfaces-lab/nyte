import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** Read the hook name of `useEffect(…)` or `React.useEffect(…)`, or null for any other call. */
function readEffectHook(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type === "Identifier") return EFFECT_HOOKS.has(callee.name) ? callee.name : null;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.property.type !== "Identifier") return null;
  return EFFECT_HOOKS.has(callee.property.name) ? callee.property.name : null;
}

/** Report every direct React effect hook; mount-time work goes through `useMountEffect`, and a real survivor states its reason. */
export const noDirectEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct useEffect, useLayoutEffect and useInsertionEffect calls; derive, handle, query, remount or useMountEffect instead.",
    },
    messages: {
      mount:
        "`{{hook}}(…, [])` is mount-time work: call `useMountEffect(…)` instead. Keep `{{hook}}` only when it must run before paint or the effect is not mount-shaped, and say why on the line above: `// oxlint-disable-next-line nyte-code/no-direct-effect -- <why>`.",
      everyRender:
        "`{{hook}}` without dependencies runs after every render. Do the work during render, in the event handler that causes it, or once in `useMountEffect`. If it truly must follow every commit, say why on the line above: `// oxlint-disable-next-line nyte-code/no-direct-effect -- <why>`.",
      synchronize:
        "`{{hook}}` reruns when its dependencies change. Derive the value during render, fetch with `useQuery`, act in the event handler that causes the change, or reset with a `key` and `useMountEffect`. If this keeps an outside system (DOM, subscription, native view) in step with changing input, say why on the line above: `// oxlint-disable-next-line nyte-code/no-direct-effect -- <why>`.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const hook = readEffectHook(node.callee);
        if (hook === null) return;

        const dependencies = node.arguments[1];
        if (dependencies === undefined) {
          context.report({ node: node.callee, messageId: "everyRender", data: { hook } });
          return;
        }

        const mount = dependencies.type === "ArrayExpression" && dependencies.elements.length === 0;
        context.report({
          node: node.callee,
          messageId: mount ? "mount" : "synchronize",
          data: { hook },
        });
      },
    };
  },
});
