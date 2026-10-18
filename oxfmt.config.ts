import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "**/*.md",
    // Generated brand assets and audit evidence, not source.
    "output/**",
    // Vendored Base UI docs; sync-base-ui-reference.mjs --check compares bytes.
    "packages/docs/content/cloud/headless/*.mdx",
    "!packages/docs/content/cloud/headless/index.mdx",
    "packages/docs/content/base-ui-reference/**",
    "**/routeTree.gen.ts",
    "packages/ai/src/providers/data/**",
    "packages/ai/src/providers/snapshots/**",
    // Playwright writes these on --update-snapshots.
    "**/*-snapshots/**",
    // The lab's film is a creative sketch, kept out of the workspace checks.
    "packages/lab/video/**",
    "packages/lab/remotion.config.ts",
  ],
});
