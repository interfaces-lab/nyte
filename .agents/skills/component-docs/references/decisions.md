# Decisions

Why each rule exists. Remove an entry when its rule goes.

## 2026-11-08, the reader works in this repo

`@nyte-ai/ui` is `private: true` and only workspace packages depend on it. The pages serve the team
and its agents. Pierre's re-exports and the worker pool export React components but wrap engines,
so they get no page.

## 2026-11-08, sourcing rules over voice rules

An audit of the 39 component pages found the source defects listed in `sourcing.md` and four
incomplete unions: Input `code`, Menu `quiet` and `action`, Row `bare`. Voice rules were almost
never broken, so they shrank to one paragraph. The skill had gone stale too. It named a
`TokenTable` component that no longer exists, ranked itself above the source, and pointed at
desktop call sites, though 3 desktop files import ui against 294 in the app.

## 2026-09-18, one component, one page

A Primitives and Headless split described our implementation, not what a reader imports. Merged
into one page per subpath. 22 pages for desktop's own components were deleted.

## 2026-09-18, include Base UI's tables, don't vendor their pages

A generator copied 11,600 lines of Base UI pages, including prose introducing demos it had
stripped. Pages now `<include>` the generated part tables. The MIT attribution is a condition of
using their text.

## Coverage gaps

- Nothing checks MDX snippets. An import check was written and removed for lack of an owner. On
  2026-11-08 a throwaway check typechecked every fence against the ui source, ignoring names
  defined outside the fence. It found three real errors, including `createPreviewCardHandle` and
  an `xstyle` the `Dialog.Title` contract rejects, with one false positive. If it returns, it
  belongs in the docs package's `typecheck` script, which CI runs. It can't judge union
  completeness or example order.
- Foundations pages have no contract.
- `check:base-ui` compares against upstream `master`, so it fails for reasons unrelated to our
  pages.
