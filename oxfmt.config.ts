import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "**/*.md",
    "output/**",
    "packages/docs/content/cloud/headless/*.mdx",
    "!packages/docs/content/cloud/headless/index.mdx",
    "packages/docs/content/base-ui-reference/**",
    "**/routeTree.gen.ts",
    "packages/ai/src/providers/data/**",
    "packages/ai/src/providers/snapshots/**",
    "**/*-snapshots/**",
    "**/.local/**",
  ],
});
