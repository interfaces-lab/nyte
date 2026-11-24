import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";

import { nyteRules } from "./scripts/oxlint/nyte-rules.ts";

const rendererCoreImports = [
  {
    name: "@nyte-ai/core",
    allowTypeImports: true,
    message:
      "The renderer takes only types from @nyte-ai/core. Runtime values come from @nyte-ai/sdk and @nyte-ai/schema.",
  },
];

const compilerMemoImport = {
  name: "react",
  importNames: ["useMemo", "useCallback", "memo"],
  message:
    "React Compiler memoizes this package. Write the plain value, function, or component; fix a compiler bailout (react/todo) instead of memoizing by hand.",
};

const uiLibraryImports = [
  {
    group: ["@base-ui/**"],
    message: "Import the styled component from @nyte-ai/ui. Base UI stays inside packages/ui.",
  },
  {
    group: ["@tanstack/react-table", "@tanstack/table-core"],
    message: "Import TanStack Table and the styled table parts from @nyte-ai/ui/table.",
  },
  {
    group: ["@pierre/**"],
    message:
      "Import Pierre through @nyte-ai/ui/<same subpath without @pierre/>, e.g. @nyte-ai/ui/diffs/react.",
  },
];

const conceptFolderImports = ["chats", "window"].map((folder) => ({
  group: [`**/${folder}/*`, `!**/${folder}/index.ts`],
  message: `Import ${folder}/ through ${folder}/index.ts. Its other files are internal; export what you need from the index.`,
}));

const desktopProcessImports = (...folders: readonly string[]) =>
  folders.map((folder) => ({
    regex: `^(\\.\\./)+${folder}/`,
    message: `Code in desktop/src/${folder}/ runs in another process. Import what both sides need from desktop/src/shared/, moving it there if it is not yet.`,
  }));

const desktopProcessFolders = [
  { folder: "main", forbidden: ["workers", "preload"] },
  { folder: "host", forbidden: ["main", "preload"] },
  { folder: "workers", forbidden: ["main", "host", "preload"] },
  { folder: "preload", forbidden: ["main", "host", "workers"] },
  { folder: "shared", forbidden: ["main", "host", "workers", "preload"] },
];

const buttonLibraryMessage =
  "Buttons come styled from @nyte-ai/ui/button and @nyte-ai/ui/toggle; pass layout through their props, not a new look.";

const runtimeLoadMessage =
  "Import modules statically. The bundler cannot follow a runtime require, and the packaged app ships no node_modules for it to find.";

const runtimeLoadImports = ["node:module", "module"].map((name) => ({
  name,
  importNames: ["createRequire"],
  message: runtimeLoadMessage,
}));

const labShellImports = [
  {
    name: "dialkit",
    message:
      "Prototypes take dials from useDials in the lab's shell, which shows them in the inspector.",
  },
  {
    name: "@nyte-ai/ui/appearance",
    message:
      "The lab's shell owns the display mode through the app's preferences; read it with useScheme.",
  },
];

const reflectGlobal = {
  name: "Reflect",
  message:
    "Use typed property access or direct invocation. Suppress this rule only for genuine reflection.",
};

const canvasKitImport = {
  name: "nyte/canvas",
  message: "nyte/canvas only resolves in the canvas runtime. Import it only from *.view.tsx files.",
};

export default defineConfig({
  ignorePatterns: [
    "output/**",
    ".agents/**",
    "scripts/oxlint/anti-slop/**",
    "scripts/oxlint/landmines/**",
    "**/worker-configuration.d.ts",
    "**/routeTree.gen.ts",
    "**/*.gen.*",
    "**/models.generated*",
    "**/.local/**",
    "packages/host/test/fixtures/language/**",
  ],
  plugins: [
    "react",
    "eslint",
    "typescript",
    "unicorn",
    "import",
    "oxc",
    "jsx-a11y",
    "promise",
    "vitest",
  ],
  jsPlugins: [
    "./packages/app/lint/design-scale.js",
    "./packages/app/lint/interactions.js",
    "./packages/app/lint/restyle.js",
    "./scripts/oxlint/anti-slop/index.ts",
    "./scripts/oxlint/landmines/style.ts",
    "./scripts/oxlint/landmines/testing.ts",
    "./scripts/oxlint/nyte-code/index.ts",
  ],
  categories: {
    correctness: "off",
  },
  rules: {
    ...nyteRules,
    "eslint/no-restricted-globals": [
      "error",
      reflectGlobal,
      { name: "require", message: runtimeLoadMessage },
    ],
    "eslint/no-restricted-imports": [
      "error",
      { paths: runtimeLoadImports, patterns: uiLibraryImports },
    ],
    "react/todo": "warn",
  },
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: "error",
  },
  settings: {
    "react-hooks": { additionalEffectHooks: "(useMountEffect)" },
    shadcn: { ui: "@nyte-ai/ui" },
    tailwindcss: { callees: ["clsx", "cva", "cn"] },
  },
  overrides: [
    {
      files: ["services/web/**"],
      jsPlugins: ["@shadcn/lint"],
      rules: {
        "shadcn/no-unknown-classes": [
          "warn",
          { allow: ["doc", "doc-*", "docs-*", "cloud-*", "design", "design-*"] },
        ],
        "shadcn/no-arbitrary-values": "warn",
        "shadcn/no-raw-colors": "warn",
        "shadcn/no-inline-styles": "warn",
        "shadcn/require-static-classes": "warn",
        "shadcn/no-restyle": ["warn", { allow: ["layout"] }],
      },
    },
    {
      files: ["services/web/src/routes/opengraph-image[.]png.tsx", "services/web/src/routes/og/**"],
      rules: { "shadcn/no-inline-styles": "off" },
    },
    {
      files: ["**/*.cjs", "**/*.test.{ts,tsx}", "scripts/**"],
      rules: {
        "eslint/no-restricted-globals": ["error", reflectGlobal],
        "eslint/no-restricted-imports": ["error", { patterns: uiLibraryImports }],
      },
    },
    {
      files: ["packages/**", "services/**", "scripts/**"],
      excludeFiles: ["scripts/oxlint/**", "packages/ai/**"],
      rules: {
        "anti-slop/no-array-filter-map": "warn",
        "anti-slop/no-reduce-accumulator-copy": "warn",
        "anti-slop/no-conditional-empty-object-spread": "warn",
        "anti-slop/no-known-value-widening": "warn",
        "anti-slop/no-module-mocking": "warn",
        "anti-slop/no-object-parameters": "warn",
        "anti-slop/no-reflect-apply": "warn",
        "anti-slop/no-reflect-get": "warn",
        "anti-slop/no-runtime-typeof": "warn",
        "anti-slop/no-shape-in-symbol-names": "warn",
        "anti-slop/no-unknown-parameters": "warn",
        "anti-slop/no-unknown-returns": "warn",
        "anti-slop/no-unknown-type-aliases": "warn",
        "anti-slop/no-unsafe-dictionary-type": "warn",
        "anti-slop/require-readable-spacing": "warn",
      },
    },
    {
      files: ["**/*.test.{ts,tsx}", "**/*.browser-test.tsx", "**/test/**", "**/e2e/**"],
      rules: { "typescript/no-non-null-assertion": "off" },
    },
    {
      files: ["**/*.{js,mjs,cjs,jsx}"],
      rules: { "typescript/use-unknown-in-catch-callback-variable": "off" },
    },
    {
      files: [
        "**/*.config.{ts,mts,js,mjs}",
        "**/lint/*.js",
        "**/fixtures/**",
        "**/design-sample/**",
        "scripts/oxlint/**",
        "scripts/release-guard.mjs",
        "packages/app/src/lib/deferred-urls.ts",
        "packages/canvas/test/probes/**",
        "packages/examples/**",
        "packages/ios/src/app/**",
        "packages/plugin/src/**",
        "packages/tui/src/{codemode-wasm,docs-files,photon-wasm}.ts",
        "services/connect-broker/src/index.ts",
        "services/metrics/src/index.ts",
      ],
      rules: { "import/no-default-export": "off" },
    },
    {
      files: ["packages/tui/src/**/*.tsx"],
      rules: {
        "react/refs": "off",
        "react/immutability": "off",
        "react/todo": "off",
      },
    },
    {
      files: ["packages/app/e2e/**", "packages/desktop/e2e/**"],
      rules: {
        "react/rules-of-hooks": "off",
      },
    },
    {
      files: ["packages/desktop/e2e/**"],
      excludeFiles: ["packages/desktop/e2e/window-capture.ts"],
      rules: {
        "eslint/no-restricted-properties": [
          "error",
          ...["screenshot", "screencast"].map((property) => ({
            object: "page",
            property,
            message:
              "A page capture leaves the window's vibrancy black. Use captureWindow or recordWindow.",
          })),
        ],
      },
    },
    {
      files: ["packages/tui/**", "packages/plugin/**"],
      rules: {
        "eslint/no-shadow": "error",
        "eslint/no-underscore-dangle": ["error", { allow: ["_exhaustive"] }],
        "eslint/no-unmodified-loop-condition": "error",
        "eslint/no-unexpected-multiline": "error",
        "eslint/no-useless-call": "error",
        "typescript/consistent-return": "error",
        "unicorn/consistent-function-scoping": "error",
        "unicorn/no-array-reverse": "error",
        "unicorn/no-array-sort": "error",
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
        "typescript/unbound-method": "off",
        "typescript/require-array-sort-compare": "off",
        "typescript/no-base-to-string": "off",
        "eslint/complexity": "off",
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
    {
      files: ["**/*.test.{ts,tsx}", "**/*.browser-test.tsx", "**/e2e/**", "**/test/**"],
      rules: {
        "nyte-code/no-direct-effect": "off",
      },
    },
    {
      files: ["packages/schema/src/model/model.ts"],
      rules: {
        "typescript/no-redundant-type-constituents": "off",
      },
    },
    {
      files: ["packages/app/src/**/*.{ts,tsx}", "packages/desktop/src/renderer/**/*.{ts,tsx}"],
      rules: {
        "react/todo": "error",
        "react/forbid-elements": [
          "error",
          { forbid: [{ element: "button", message: buttonLibraryMessage }] },
        ],
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: [...rendererCoreImports, compilerMemoImport, ...runtimeLoadImports],
            patterns: [...uiLibraryImports, ...conceptFolderImports],
          },
        ],
      },
    },
    {
      files: [
        "packages/app/src/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/lab/src/**/*.{ts,tsx}",
      ],
      rules: {
        "nyte-design/control-size": "error",
        "nyte-design/touch-in-tokens": "error",
      },
    },
    {
      files: [
        "packages/app/src/**/*.{ts,tsx}",
        "packages/desktop/src/renderer/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/canvas/src/**/*.{ts,tsx}",
      ],
      excludeFiles: ["packages/ui/src/styles/**"],
      rules: {
        "nyte-design/spacing-scale": "error",
        "nyte-design/size-grid": "error",
        "nyte-design/no-raw-colors": "error",
        "nyte-design/no-raw-font-weight": "error",
        "nyte-design/guarded-hover": "error",
        "nyte-design/logical-properties": "error",
      },
    },
    {
      files: [
        "packages/app/src/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/lab/src/**/*.{ts,tsx}",
      ],
      excludeFiles: ["packages/ui/src/styles/**"],
      rules: { "nyte-design/no-light-dark-outside-tokens": "error" },
    },
    {
      files: [
        "packages/app/src/**/*.{ts,tsx}",
        "packages/desktop/src/renderer/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/canvas/src/**/*.{ts,tsx}",
        "packages/lab/src/**/*.{ts,tsx}",
      ],
      excludeFiles: ["packages/ui/src/styles/**", "packages/app/src/theme/vscode-theme.ts"],
      rules: { "nyte-design/no-faded-ink": "error", "nyte-design/disabled-ink": "error" },
    },
    {
      files: ["packages/app/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
      rules: {
        "nyte-interactions/no-clickable-non-control": "error",
        "nyte-interactions/drag-only-touch-action": "error",
        "nyte-interactions/restore-popup-focus": "error",
        "nyte-interactions/specific-confirm-label": "error",
        "nyte-interactions/no-disabled-caption": "error",
        "nyte-interactions/title-case-control-label": "error",
        "nyte-interactions/no-stacked-fills": "error",
      },
    },
    {
      files: [
        "packages/app/src/**/*.{ts,tsx}",
        "packages/lab/src/**/*.{ts,tsx}",
        "packages/canvas/src/**/*.{ts,tsx}",
      ],
      rules: { "nyte-restyle/no-restyle": "error" },
    },
    {
      files: [
        "packages/app/**/*.{ts,tsx}",
        "packages/ui/**/*.{ts,tsx}",
        "packages/lab/**/*.{ts,tsx}",
        "packages/ios/**/*.{ts,tsx}",
      ],
      rules: { "nyte-interactions/named-stylex-imports": "error" },
    },
    {
      files: ["packages/ios/src/**/*.{ts,tsx}"],
      rules: {
        "nyte-interactions/accessible-pressable": "error",
        "nyte-interactions/specific-confirm-label": "error",
      },
    },
    {
      files: ["packages/app/src/**/*.test.{ts,tsx}"],
      rules: {
        "eslint/no-restricted-imports": ["error", { patterns: uiLibraryImports }],
      },
    },
    {
      files: ["packages/app/src/**/*.browser-test.tsx"],
      rules: {
        "react/forbid-elements": "off",
        "nyte-interactions/no-clickable-non-control": "off",
      },
    },
    {
      files: ["packages/app/src/environments/pairing-code.tsx"],
      rules: {
        "nyte-design/no-raw-colors": "off",
      },
    },
    {
      files: ["packages/ui/**"],
      rules: {
        "eslint/no-restricted-imports": "off",
      },
    },
    {
      files: ["packages/host/src/local/process/jobs.ts"],
      rules: {
        "eslint/no-restricted-imports": ["error", { patterns: uiLibraryImports }],
      },
    },
    {
      files: ["packages/plugin/src/**"],
      excludeFiles: ["packages/plugin/src/**/*.view.tsx"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          { paths: [...runtimeLoadImports, canvasKitImport], patterns: uiLibraryImports },
        ],
      },
    },
    {
      files: ["packages/plugin/src/codemode-runtime.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          { paths: [canvasKitImport], patterns: uiLibraryImports },
        ],
      },
    },
    {
      files: ["packages/lab/src/**/*.{ts,tsx}"],
      excludeFiles: ["packages/lab/src/shell/**"],
      rules: {
        "nyte-design/no-raw-colors": "error",
        "eslint/no-restricted-imports": [
          "error",
          { paths: [...runtimeLoadImports, ...labShellImports], patterns: uiLibraryImports },
        ],
        "eslint/no-restricted-properties": [
          "error",
          {
            object: "document",
            property: "documentElement",
            message:
              "The lab's shell owns the document root. Override tokens from the inspector, or style the prototype's own element.",
          },
        ],
      },
    },
    {
      files: ["packages/lab/src/studio/films/**"],
      rules: { "nyte-design/no-raw-colors": "off" },
    },
    ...desktopProcessFolders.map(({ folder, forbidden }): OxlintOverride => ({
      files: [`packages/desktop/src/${folder}/**`],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            paths: runtimeLoadImports,
            patterns: [...uiLibraryImports, ...desktopProcessImports(...forbidden)],
          },
        ],
      },
    })),
  ],
});
