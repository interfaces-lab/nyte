# Decisions

Why each rule exists. Remove an entry when its rule goes.

- **2026-11-08, the reader works in this repo.** `@nyte-ai/ui` is `private: true` with only
  workspace dependents, so pages serve the team and its agents. Pierre's re-exports and the worker
  pool export React components but wrap engines, so they get no page.
- **2026-11-08, sourcing over voice.** An audit of the 39 component pages found the named failures
  and four incomplete unions (Input `code`, Menu `quiet` and `action`, Row `bare`) but few voice
  slips, so voice rules shrank to one paragraph. The skill had ranked itself above the source and
  cited desktop call sites, though 3 desktop files imported ui against 294 in the app.
- **2026-09-18, one page per subpath.** A Primitives and Headless split described our
  implementation, not what a reader imports. The desktop's component pages went with it.
- **2026-09-18, include Base UI's tables, don't vendor pages.** A generator had copied 11,600 lines
  of Base UI pages, including prose introducing demos it stripped. The MIT attribution is a
  condition of using their text.

## Coverage gaps

- Nothing checks MDX snippets; an import check was removed for lack of an owner. A 2026-11-08
  throwaway check typechecked every fence against the ui source, ignoring names defined outside
  the fence, and found three real errors (one an `xstyle` the `Dialog.Title` contract rejects) and
  one false positive. A returning check belongs in the docs package's `typecheck` script, which CI
  runs. It can't judge union completeness or example order.
- Foundations pages have no contract.
