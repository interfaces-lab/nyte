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

A review or a question gets findings with `path:line`, not edits.

- Which subpaths get a page, and its order: [page-contract.md](references/page-contract.md).
- Which source wins, for every page including foundations: [sourcing.md](references/sourcing.md).
- Why each rule exists, before changing one: [decisions.md](references/decisions.md).
