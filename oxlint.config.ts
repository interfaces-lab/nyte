import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["react", "eslint", "typescript", "unicorn", "import"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
  ignorePatterns: ["tools/oxlint/anti-slop/**"],
  // Vendored from https://github.com/dmmulroy/anti-slop (src/); ours to maintain.
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    {
      // The terminal client and the plugin examples carry every suspicious and
      // perf rule as an error. Sequential awaits are how a shell is written, so
      // that one rule stays off; `_exhaustive` is the never-check idiom.
      files: ["packages/tui/**", "packages/plugin/**"],
      rules: {
        "eslint/block-scoped-var": "error",
        "eslint/no-extend-native": "error",
        "eslint/no-extra-bind": "error",
        "eslint/no-implied-eval": "error",
        "eslint/no-new": "error",
        "eslint/no-shadow": "error",
        "eslint/no-underscore-dangle": ["error", { allow: ["_exhaustive"] }],
        "eslint/no-unmodified-loop-condition": "error",
        "eslint/no-unexpected-multiline": "error",
        "eslint/no-unneeded-ternary": "error",
        "eslint/no-useless-call": "error",
        "eslint/no-useless-concat": "error",
        "eslint/no-useless-constructor": "error",
        "eslint/preserve-caught-error": "error",
        "typescript/consistent-return": "error",
        "typescript/no-confusing-non-null-assertion": "error",
        "typescript/no-misused-promises": "error",
        "typescript/no-unnecessary-boolean-literal-compare": "error",
        "typescript/no-unnecessary-template-expression": "error",
        "typescript/no-unnecessary-type-arguments": "error",
        "typescript/no-unnecessary-type-assertion": "error",
        "typescript/no-unnecessary-type-parameters": "error",
        "typescript/no-unsafe-enum-comparison": "error",
        "typescript/no-unsafe-type-assertion": "error",
        "unicorn/consistent-function-scoping": "error",
        "unicorn/no-accessor-recursion": "error",
        "unicorn/no-array-fill-with-reference-type": "error",
        "unicorn/no-array-reverse": "error",
        "unicorn/no-array-sort": "error",
        "unicorn/no-confusing-array-with": "error",
        "unicorn/no-instanceof-builtins": "error",
        "unicorn/prefer-add-event-listener": "error",
        "unicorn/prefer-array-find": "error",
        "import/no-absolute-path": "error",
        "import/no-self-import": "error",
        "import/no-unassigned-import": "error",
      },
    },
    {
      files: [
        "packages/ai/src/api/**",
        "packages/ai/src/models.ts",
        "packages/ai/src/models-store.ts",
        "packages/ai/src/utils/**",
        "packages/ai/src/auth/**",
        "packages/ai/scripts/**",
        "packages/ai/src/env-api-keys.ts",
        "packages/ai/src/session-resources.ts",
        "packages/ai/test/upstream/**",
      ],
      rules: {
        "typescript/no-floating-promises": "off",
        "eslint/no-constant-binary-expression": "off",
        "unicorn/no-useless-fallback-in-spread": "off",
        "eslint/no-unused-vars": "off",
        "eslint/no-useless-escape": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/no-redundant-type-constituents": "off",
        "typescript/no-explicit-any": "off",
        "typescript/unbound-method": "off",
        "typescript/require-array-sort-compare": "off",
        "typescript/no-base-to-string": "off",
        "eslint/complexity": "off",
      },
    },
    {
      // node:test's test() returns a promise the runner already tracks.
      files: ["**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
    {
      files: ["packages/schema/src/model.ts", "packages/schema/src/message.ts"],
      rules: {
        "typescript/no-redundant-type-constituents": "off",
      },
    },
    {
      files: ["packages/desktop/src/renderer/**/*.{ts,tsx}"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@nyte-ai/core",
                allowTypeImports: true,
                message: "Renderer value imports use the browser-safe @nyte-ai/core/views entry.",
              },
            ],
            patterns: [
              {
                group: ["@nyte-ai/core/*", "!@nyte-ai/core/views"],
                allowTypeImports: true,
                message: "Renderer value imports use the browser-safe @nyte-ai/core/views entry.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/core/src/plugins/builtin/**"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/harness/**", "../../harness/*"],
                message:
                  "Built-in plugins use SessionApi only. If the API is missing something, add a primitive.",
              },
            ],
          },
        ],
      },
    },
  ],
});
