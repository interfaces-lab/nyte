---
name: component-docs
description: >
  Authoring and reviewing the Cloud component documentation in packages/docs/content/design (served at design.nyte.sh).
  Use whenever work adds, edits, or reviews a page under content/design, changes what
  @nyte-ai/ui exports, or answers a question by citing those pages. Trigger on component docs,
  design system docs, styled components, tokens, theming, and any request to document a
  component or check that a page is still true.
  Not for marketing pages under src/routes, or code changes in packages/ui that leave the public exports unchanged.
paths:
  - "packages/docs/content/design/**"
  - "packages/ui/package.json"
---

# Cloud component docs

These pages document `@nyte-ai/ui` for the team and its agents. The package is private and only
this repo's workspace packages depend on it, so the pages are the reference for what it does, and a
wrong example becomes a wrong commit.

## Authority

1. `packages/ui/src` and `packages/ui/package.json`. The package is the truth.
2. `content/base-ui-reference/`, the generated Base UI tables.
3. This skill and [references/decisions.md](references/decisions.md).
4. The existing pages. They are the least reliable source, and three defects reached them by an
   agent trusting a neighbouring page over the source.

## Workflow

1. Read `packages/ui/package.json` exports. Every component import path is one page, named for the
   component. Asset, style, helper and engine re-export paths (`diffs`, `trees`, `highlights`,
   `worker-pool`, `code-themes`) get no page; the ui `AGENTS.md` documents the engines.
2. Read the component source before writing a sentence about it. Component subpaths resolve
   directly to `packages/ui/src/<name>.tsx`; check the manifest for shared implementations.
3. Write the page against [references/page-contract.md](references/page-contract.md).
4. Verify against [references/sourcing.md](references/sourcing.md) before reporting done.

## Boundaries

- Document what `@nyte-ai/ui` exports. The app's and desktop's own components and surfaces get no
  pages. That section existed once and was deleted.
- Do not vendor Base UI's prose. Pull their props tables in with `<include>` so a regenerated
  table never rewrites our words.
- Do not inherit Base UI's emphasis. Their pages weight every API equally because they document a
  library. Ours weight what a reader reaches for first.
