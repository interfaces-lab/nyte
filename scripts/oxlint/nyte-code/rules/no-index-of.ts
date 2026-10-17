import { defineRule } from "@oxlint/plugins";

/** Disallow `.indexOf`; `includes`, `findIndex`, `find`, `at`, `startsWith` and `slice` say what the caller wants. */
export const noIndexOfRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow `.indexOf`; use `includes`, `findIndex`, `find`, `at`, `startsWith` or `slice`.",
    },
    messages: {
      indexOf:
        "Use includes() for membership, findIndex()/find() for search, or startsWith()/at()/slice() for position. indexOf returns a -1 sentinel every caller must remember to check.",
    },
  },
  createOnce(context) {
    return {
      MemberExpression(node) {
        const name =
          node.property.type === "Identifier" && !node.computed
            ? node.property.name
            : node.property.type === "Literal"
              ? node.property.value
              : null;

        if (name !== "indexOf") return;
        context.report({ node: node.property, messageId: "indexOf" });
      },
    };
  },
});
