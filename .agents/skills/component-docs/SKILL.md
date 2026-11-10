---
name: component-docs
description: >
  Write, review, or answer questions from the @nyte-ai/ui pages in packages/docs/content/design
  (design.nyte.sh). Also use when a change in packages/ui adds a component subpath, or adds,
  removes, or renames a prop, part, or union member. Not for marketing pages under src/routes, or
  ui changes that leave every exported type as it was.
paths:
  - "packages/docs/content/design/**"
  - "packages/ui/package.json"
---

# Design system docs

These pages document `@nyte-ai/ui` for the team and its agents. Agents paste their snippets into
commits, so a wrong page becomes wrong code. A review or a question gets findings with `path:line`,
not edits.

## Authority

1. `packages/ui/src` and the `exports` in `packages/ui/package.json`.
2. The installed `@base-ui/react` types.
3. `content/base-ui-reference/`, generated from the pinned Base UI release with wording
   corrections owned by the generator. The installed types still take precedence.
4. The existing pages. Every recorded defect came from trusting one over the source.

## Scope

One page per component subpath. Style, asset, helper and engine subpaths (`diffs`, `trees`,
`highlights`, `worker-pool`, `code-themes`) get none, and neither do the app's or desktop's own
components. Component pages follow [page-contract.md](references/page-contract.md). Every page,
foundations included, follows [sourcing.md](references/sourcing.md).

[decisions.md](references/decisions.md) records why each rule exists. Read it before changing a
rule.
