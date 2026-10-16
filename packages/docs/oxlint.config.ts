import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "react", "import"],
  jsPlugins: ["@shadcn/lint"],
  categories: {},
  rules: {
    "eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@base-ui/**"],
            message:
              "Import the styled component from @nyte-ai/ui. Base UI stays inside packages/ui.",
          },
        ],
      },
    ],
    "shadcn/no-unknown-classes": ["warn", { allow: ["doc", "doc-*", "docs-*", "cloud-*"] }],
    "shadcn/no-arbitrary-values": "warn",
    "shadcn/no-raw-colors": "warn",
    "shadcn/no-inline-styles": "warn",
    "shadcn/require-static-classes": "warn",
    "shadcn/no-restyle": ["warn", { allow: ["layout"] }],
  },
  env: {
    builtin: true,
  },
  settings: {
    react: {
      version: "19.2.8",
    },
    shadcn: {
      ui: "@nyte-ai/ui",
    },
    tailwindcss: {
      callees: ["clsx", "cva", "cn"],
    },
  },
  overrides: [
    {
      files: ["src/routes/opengraph-image[.]png.tsx", "src/routes/og/**"],
      rules: { "shadcn/no-inline-styles": "off" },
    },
  ],
  ignorePatterns: ["node_modules/", "src/routeTree.gen.ts"],
});
