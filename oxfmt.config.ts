import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "**/*.md",
    // Generated brand assets and audit evidence, not source.
    "output/**",
    "**/platform-tokens.css",
    // Vendored Base UI docs; sync-base-ui-reference.mjs --check compares bytes.
    "packages/docs/content/cloud/headless/*.mdx",
    "!packages/docs/content/cloud/headless/index.mdx",
    "packages/docs/content/base-ui-reference/**",
    "**/routeTree.gen.ts",
    "packages/ai/src/providers/data/**",
    "packages/ai/src/providers/snapshots/**",
  ],
});
