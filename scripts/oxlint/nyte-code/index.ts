import { eslintCompatPlugin } from "@oxlint/plugins";

import { declarativeCommentsRule } from "./rules/declarative-comments.ts";
import { noCrossPackageRelativeImportsRule } from "./rules/no-cross-package-relative-imports.ts";
import { noDirectEffectRule } from "./rules/no-direct-effect.ts";
import { noIsHelperNamesRule } from "./rules/no-is-helper-names.ts";
import { noOfLookupNamesRule } from "./rules/no-of-lookup-names.ts";
import { noOneOffBooleanHelpersRule } from "./rules/no-one-off-boolean-helpers.ts";
import { requireSuppressionReasonRule } from "./rules/require-suppression-reason.ts";

/** Nyte's code-shape rules from AGENTS.md. */
const nyteCodePlugin = eslintCompatPlugin({
  meta: { name: "nyte-code" },
  rules: {
    "declarative-comments": declarativeCommentsRule,
    "no-cross-package-relative-imports": noCrossPackageRelativeImportsRule,
    "no-direct-effect": noDirectEffectRule,
    "no-is-helper-names": noIsHelperNamesRule,
    "no-of-lookup-names": noOfLookupNamesRule,
    "no-one-off-boolean-helpers": noOneOffBooleanHelpersRule,
    "require-suppression-reason": requireSuppressionReasonRule,
  },
});

export default nyteCodePlugin;
