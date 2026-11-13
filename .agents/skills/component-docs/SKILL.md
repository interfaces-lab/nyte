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

Use this skill to write a design-site page for an `@nyte-ai/ui` component, to review one, or to answer a question from one. Decide which subpaths get a page, trace every claim to the source that wins, write the page in the fixed order, and check the page by hand before reporting done.

## Scope and audience

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

1. **Report findings, not edits, for a review or a question.** A review or a question gets findings with `path:line`, and the files stay as they are.
2. **Write for the team and its agents.** `@nyte-ai/ui` is `private: true` and has only workspace dependents, so the pages serve people and agents who work in this repo.
3. **Give each component subpath one page.** Organize pages by what a reader imports, not by how ui implements a component. Do not split pages into groups such as Primitives and Headless.
4. **Give no page to anything else.** Style, asset, helper and engine subpaths (`diffs`, `trees`, `highlights`, `worker-pool`, `code-themes`) get no page, and neither do the app's or the desktop's own components. Pierre's re-exports and the worker pool export React components but wrap engines, so they get no page either.

## Sourcing

5. **Trace every claim to a file.** When two sources disagree, the higher source in rules 6 to 9 wins. This skill does not outrank the source.
6. **Trust the ui source first.** Take import paths from `exports` in `packages/ui/package.json`. Take names, props and defaults from the file that the subpath's `nyte-source` entry names in `packages/ui/src`, and take every member of a union from its exported type.
7. **Trust the installed Base UI types second.** Read the installed `@base-ui/react` types when the ui source does not answer the question.
8. **Trust the generated reference third.** `content/base-ui-reference/` is generated from the pinned Base UI release. Fix its wording in the generator, not in the generated pages.
9. **Trust existing pages last.** Every recorded defect came from trusting an existing page over the source.
10. **Check usage only in the app.** Call sites in `packages/app/src` only confirm real usage, and they never decide what a page says. Do not cite desktop call sites, because the desktop barely imports ui.
11. **Write snippets in the repo's code style.** Snippets follow the code style in the root `AGENTS.md`.
12. **Never import a name the subpath does not export.** Check the subpath's `exports` entry and its source file before writing an import.
13. **Do not copy a claim from a neighbouring page.** Check each claim against the source, even when other pages repeat it. For example, `StyledProps` keeps Base UI's types, so `className` and `style` accept functions of state as well as plain values.
14. **List every union member in the props table.** A demo may show a subset of a union, but the props table lists every member of the exported type.
15. **Lead with what a reader uses first, not with Base UI's emphasis.** Alert dialog leads with nesting the trigger, then `open` with `onOpenChange`, not with `createHandle()` as Base UI's overlay pages do.
16. **Pair each controlled prop with its own handler.** `pressed` goes with `onPressedChange`, and `checked` goes with `onCheckedChange`.
17. **Replace a wrong sentence instead of qualifying it.** Do not patch a sentence with "unless", "except" or "with the default". If the true sentence needs a qualifier for a case outside a reader's first ten uses, cut the sentence.
18. **Apply the sourcing rules to every page.** Rules 5 to 17 hold for foundations pages as well as component pages.

## Page contract

19. **Keep the section order on every component page.** Every component page except the components `index.mdx` overview holds the order in rules 20 to 27.
20. **Start with frontmatter.** Give the page a frontmatter `title` and a one-line `description`.
21. **Show the import next.** Add one fence that imports from the component's own subpath.
22. **Introduce the component in one or two sentences.** Say what it is and when to reach for it.
23. **Put only typing rules in `## Usage`.** Include only rules that change what a reader types.
24. **List the parts in `## Anatomy`.** List the parts in nesting order, and add the section only when the component has more than one part.
25. **Order `## Examples` by a reader's first ten uses.** Use `<Preview>` for a registered demo and a fence otherwise. Do not follow the order of Base UI's sections, and make a demo and its fence show the same API.
26. **Build `## Props` from our table and Base UI's includes.** Write our props table, then add an `<include>` for each Base UI part with the MIT attribution line, which is a condition of using Base UI's text. An unstyled pass-through part, such as a trigger or a portal, gets one line saying so and its `<include>`, with no table of ours and none of Base UI's prose.
27. **End with `## Accessibility`.** Describe the keyboard model, focus and ARIA.
28. **Include Base UI's tables, never its pages.** Never copy Base UI's prose, and never introduce an example that the page does not show.
29. **Leave the internals out.** Leave out repo paths, generator commands, implementation history and the roadmap, but keep any limit the caller hits.
30. **Follow the house style.** Use sentence-case headings and straight quotes, no em dashes, and no colon joining two clauses. Cut any sentence that could appear unchanged in another project's docs.
31. **Use only registered MDX components.** Use only the components registered in `packages/docs/src/components/mdx.tsx`.

## Before reporting done

32. **Check snippets by hand.** `pnpm --dir packages/docs typecheck` skips MDX and passes with a broken snippet. Check by hand that every imported name is exported by its subpath, that every union in a props table is complete, and that every `<include>` resolves from its page.
33. **Run the typecheck and the format check.**

    ```sh
    pnpm --dir packages/docs typecheck
    pnpm format
    ```

34. **Put a snippet check in the docs typecheck.** Nothing checks MDX snippets today. A check that returns belongs in the docs package's `typecheck` script, which CI runs. Such a check cannot judge union completeness or example order, so rules 14 and 25 still need a person.
