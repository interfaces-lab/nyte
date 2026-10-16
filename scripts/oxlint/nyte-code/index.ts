import { eslintCompatPlugin } from "@oxlint/plugins";

import { declarativeCommentsRule } from "./rules/declarative-comments.ts";
import { noCrossPackageRelativeImportsRule } from "./rules/no-cross-package-relative-imports.ts";
import { noIndexOfRule } from "./rules/no-index-of.ts";
import { noIsHelperNamesRule } from "./rules/no-is-helper-names.ts";
import { noOfLookupNamesRule } from "./rules/no-of-lookup-names.ts";
import { noOneOffBooleanHelpersRule } from "./rules/no-one-off-boolean-helpers.ts";

/** Nyte's code-shape rules from AGENTS.md: no is* or …Of helpers, no indexOf, declarative comments only, no one-off boolean helpers, no relative imports into another package. */
const nyteCodePlugin = eslintCompatPlugin({
  meta: { name: "nyte-code" },
  rules: {
    "declarative-comments": declarativeCommentsRule,
    "no-cross-package-relative-imports": noCrossPackageRelativeImportsRule,
    "no-index-of": noIndexOfRule,
    "no-is-helper-names": noIsHelperNamesRule,
    "no-of-lookup-names": noOfLookupNamesRule,
    "no-one-off-boolean-helpers": noOneOffBooleanHelpersRule,
  },
});

export default nyteCodePlugin;
