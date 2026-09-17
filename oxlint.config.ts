import { defineConfig } from "oxlint";

export default defineConfig({
  // Generated brand assets and audit evidence, not source.
  ignorePatterns: ["output/**"],
  plugins: ["react", "eslint", "typescript", "unicorn", "import"],
  // The desktop design scale: enforced on StyleX sources, not wrapped in tokens.
  jsPlugins: ["./packages/desktop/lint/design-scale.js"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
  overrides: [
    {
      // Solid components run once and read refs after the tree is built; the
      // React render-purity rules describe a different runtime.
      files: ["packages/tui/src/**/*.tsx"],
      rules: {
        "react/refs": "off",
        "react/immutability": "off",
      },
    },
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
        "nyte-design/spacing-scale": "error",
        "nyte-design/size-grid": "error",
        "nyte-design/no-raw-colors": "error",
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@nyte-ai/core",
                allowTypeImports: true,
                message:
                  "Renderer value imports use the browser-safe @nyte-ai/core/views and @nyte-ai/core/client entries.",
              },
            ],
            patterns: [
              {
                group: ["@nyte-ai/core/*", "!@nyte-ai/core/views", "!@nyte-ai/core/client"],
                allowTypeImports: true,
                message:
                  "Renderer value imports use the browser-safe @nyte-ai/core/views and @nyte-ai/core/client entries.",
              },
            ],
          },
        ],
      },
    },
    {
      // The restriction above keeps Node-only core code out of the shipped
      // renderer bundle. A Node-run unit test is not part of that bundle, so it
      // may import the full surface; `*.browser-test.tsx` still loads in a real
      // browser and stays restricted.
      files: ["packages/desktop/src/renderer/**/*.test.{ts,tsx}"],
      rules: {
        "eslint/no-restricted-imports": "off",
      },
    },
    {
      // The tint preview paints the raw hue the user is choosing, and the QR
      // code needs a white quiet zone a camera can read; neither resolves
      // through the palette.
      files: [
        "packages/desktop/src/renderer/src/chrome/appearance-panel.stylex.ts",
        "packages/desktop/src/renderer/src/chrome/pairing-code.tsx",
      ],
      rules: {
        "nyte-design/no-raw-colors": "off",
      },
    },
    {
      // Effects exist to synchronize with an external system; derived state,
      // fetching (TanStack Query), event relays, and per-prop resets each have
      // a better primitive. Legitimate survivors carry an inline disable.
      files: ["packages/ios/src/**/*.{ts,tsx}"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                importNames: ["useEffect"],
                message:
                  "No direct useEffect: derive inline, fetch with useQuery, act in the event handler, remount via key, or useMountEffect for mount-time external sync.",
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
