# Decisions

Why each rule exists. Remove an entry when its rule goes.

## 2026-11-08, the reader works in this repo

`@nyte-ai/ui` is `private: true` and only workspace packages depend on it. The pages serve the team
and its agents. Pierre's re-exports and the worker pool export React components but wrap engines,
so they get no page.

## 2026-11-08, sourcing rules over voice rules

An audit of the 39 component pages found the source defects listed in `sourcing.md` and four
incomplete unions: Input `code`, Menu `quiet` and `action`, Row `bare`. Voice rules were almost
never broken, so they shrank to one paragraph. The skill had also ranked itself above the source
and pointed at desktop call sites, though 3 desktop files imported ui against 294 in the app.

## 2026-09-18, one component, one page

A Primitives and Headless split described our implementation, not what a reader imports, so it
merged into one page per subpath. The pages for desktop's own components were deleted.

## 2026-09-18, include Base UI's tables, don't vendor their pages

A generator copied 11,600 lines of Base UI pages, including prose introducing demos it had
stripped. Pages now `<include>` the generated part tables. The MIT attribution is a condition of
using their text.

## Coverage gaps

- Nothing checks MDX snippets. An import check was written and removed for lack of an owner. On
  2026-11-08 a throwaway check typechecked every fence against the ui source, ignoring names
  defined outside the fence. It found three real errors, including a `createPreviewCardHandle`
  import ui didn't export yet and an `xstyle` the `Dialog.Title` contract rejects, with one false
  positive. If it returns, it belongs in the docs package's `typecheck` script, which CI runs. It
  can't judge union completeness or example order.
- Foundations pages have no contract.
