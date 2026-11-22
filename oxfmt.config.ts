import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "**/*.md",
    "output/**",
    "services/web/content/cloud/headless/*.mdx",
    "!services/web/content/cloud/headless/index.mdx",
    "**/routeTree.gen.ts",
    "packages/ai/src/providers/data/**",
    "packages/ai/src/providers/snapshots/**",
    "**/*-snapshots/**",
    "**/.local/**",
    "packages/host/test/fixtures/language/**",
  ],
});
