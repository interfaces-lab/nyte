import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const RPC_BASES = new Set(["DurableObject", "WorkerEntrypoint", "WorkflowEntrypoint", "RpcTarget"]);

export const noHashPrivateRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow `#name` class members outside RPC classes; mark them with TypeScript's `private` modifier.",
    },
    messages: {
      hashPrivate:
        'Write "private {{name}}" instead of "#{{name}}". One way to mark a member private keeps classes uniform, and the type checker already enforces it.',
    },
  },
  createOnce(context) {
    const reportMember = (
      node: ESTree.MethodDefinition | ESTree.PropertyDefinition | ESTree.AccessorProperty,
    ) => {
      if (node.key.type !== "PrivateIdentifier") return;

      const owner = node.parent.parent;
      const base =
        owner?.type === "ClassDeclaration" || owner?.type === "ClassExpression"
          ? owner.superClass
          : null;

      if (base?.type === "Identifier" && RPC_BASES.has(base.name)) return;
      context.report({ node: node.key, messageId: "hashPrivate", data: { name: node.key.name } });
    };

    return {
      MethodDefinition: reportMember,
      PropertyDefinition: reportMember,
      AccessorProperty: reportMember,
    };
  },
});
