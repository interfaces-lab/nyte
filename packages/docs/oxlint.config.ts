import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "react", "import", "nextjs"],
  categories: {},
  rules: {
    "eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@base-ui/**", "sonner"],
            message:
              "Import the styled component from @nyte-ai/ui. Base UI and sonner stay inside packages/ui.",
          },
        ],
      },
    ],
  },
  env: {
    builtin: true,
  },
  settings: {
    react: {
      version: "19.2.8",
    },
    tailwindcss: {
      callees: ["clsx", "cva", "cn"],
    },
  },
  ignorePatterns: ["node_modules/"],
});
