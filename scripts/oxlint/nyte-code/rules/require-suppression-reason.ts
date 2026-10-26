import { defineRule } from "@oxlint/plugins";

/** Require every lint suppression to end in `-- <why>`. */
export const requireSuppressionReasonRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every oxlint or eslint disable directive to state its reason after `--`.",
    },
    messages: {
      missingReason:
        "Say why this rule does not apply here: end the directive with ` -- <why>`, for example `// oxlint-disable-next-line {{rules}} -- <why>`.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const directives = context.sourceCode.getDisableDirectives().directives;

        for (const directive of directives) {
          if (directive.type === "enable" || directive.justification.trim() !== "") continue;
          context.report({
            loc: directive.node.loc,
            messageId: "missingReason",
            data: { rules: directive.value.trim() || "<rule>" },
          });
        }
      },
    };
  },
});
