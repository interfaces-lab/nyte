---
name: component-docs
description: >
  Authoring and reviewing the Cloud component documentation in packages/docs/content/cloud.
  Use whenever work adds, edits, or reviews a page under content/cloud, changes what
  @nyte-ai/ui exports, or answers a question by citing those pages. Trigger on component docs,
  design system docs, primitives, headless, tokens, theming, and any request to document a
  component or check that a page is still true.
  Not for the core design record in content/docs/design.mdx, marketing pages under src/app,
  or code changes in packages/ui that leave the public exports unchanged.
---

# Cloud component docs

These pages document `@nyte-ai/ui` for someone who installed it. The team and its agents also
read them as the reference for what the package does, so a wrong example becomes a wrong commit.

## Authority

1. `packages/ui/src` and `packages/ui/package.json`. The package is the truth.
2. `content/base-ui-reference/`, the generated Base UI tables.
3. This skill and [references/decisions.md](references/decisions.md).
4. The existing pages. They are the least reliable source, and three defects reached them by an
   agent trusting a neighbouring page over the source.

## Workflow

1. Read `packages/ui/package.json` exports. Every import path is one page, named for the
   component, except `/sonner`, which is the Toast page. Asset paths get no page.
2. Read the component source before writing a sentence about it. Root exports live in
   `packages/ui/src/index.ts`, subpaths in `packages/ui/src/<name>.ts`, styled components in
   `packages/ui/src/components/ui/`.
3. Write the page against [references/page-contract.md](references/page-contract.md).
4. Verify against [references/sourcing.md](references/sourcing.md) before reporting done.

## Boundaries

- Document what a reader can install. `@nyte-ai/desktop` is private, so its components and app
  surfaces get no pages. That section existed once and was deleted.
- Do not vendor Base UI's prose. Pull their props tables in with `<include>` so a regenerated
  table never rewrites our words.
- Do not inherit Base UI's emphasis. Their pages weight every API equally because they document a
  library. Ours weight what a reader reaches for first.
