---
name: component-docs
description: >
  Write, review, or answer questions from the @nyte-ai/ui pages in services/web/content/design
  (design.nyte.sh). Also use when a change in packages/ui adds a component subpath, or adds,
  removes, or renames a prop, part, or union member. Not for marketing pages under src/routes, or
  ui changes that leave every exported type as it was.
paths:
  - "services/web/content/design/**"
  - "packages/ui/package.json"
---

# Design system docs

Use this skill to write a design-site page for an `@nyte-ai/ui` component, to review one, or to answer a question from one. Decide which subpaths get a page. Trace every claim to the source that wins. Write the page in the fixed order. Check it by hand before reporting done.

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

## Scope and audience

1. **A review or a question gets findings, not edits.** Give each finding a `path:line`. Leave the files as they are.
2. **Write for the team and its agents.** `@nyte-ai/ui` is `private: true` and has only workspace dependents. The pages serve people and agents who work in this repo.
3. **Give each component subpath one page.** Organize pages by what a reader imports, not by how ui implements a component. Don't split pages into groups such as Primitives and Headless.
4. **Give no page to anything else.** Style, asset, helper and engine subpaths (`diffs`, `trees`, `highlights`, `worker-pool`, `code-themes`) get no page. Neither do the app's or the desktop's own components. Pierre's re-exports and the worker pool export React components but wrap engines, so they get no page either.

## Sourcing

5. **Trace every claim to a file.** When two sources disagree, the higher source in rules 6, 7 and 9 wins. This skill does not outrank the source.
6. **Trust the ui source first.** Take import paths from `exports` in `packages/ui/package.json`. Take names, props and defaults from the file that the subpath's `nyte-source` entry names in `packages/ui/src`. Take every member of a union from its exported type.
7. **Trust the installed Base UI types second.** Read the installed `@base-ui/react` types when the ui source doesn't answer the question.
9. **Trust existing pages last.** Every recorded defect came from trusting an existing page over the source.
10. **Check usage only in the app.** Call sites in `packages/app/src` confirm real usage. They never decide what a page says. Don't cite desktop call sites, because the desktop barely imports ui.
11. **Write snippets in the repo's code style,** from the root `AGENTS.md`.
12. **Never import a name the subpath doesn't export.** Check the subpath's `exports` entry and its source file before writing an import.
13. **Don't copy a claim from a neighbouring page.** Check each claim against the source, even when other pages repeat it. For example, `StyledProps` keeps Base UI's types, so `className` and `style` accept functions of state as well as plain values.
14. **List every union member in the props table.** A demo may show a subset. The props table lists every member of the exported type.
15. **Lead with what a reader uses first, not with Base UI's emphasis.** Alert dialog leads with nesting the trigger, then `open` with `onOpenChange`. It doesn't lead with `createHandle()`, as Base UI's overlay pages do.
16. **Pair each controlled prop with its own handler.** `pressed` goes with `onPressedChange`. `checked` goes with `onCheckedChange`.
17. **Replace a wrong sentence. Don't qualify it.** Don't patch a sentence with "unless", "except" or "with the default". If the true sentence needs a qualifier for a case outside a reader's first ten uses, cut the sentence.
18. **Apply the sourcing rules to every page.** Rules 5 to 17 hold for foundations pages as well as component pages.

## Page contract

19. **Keep the section order on every component page.** Rules 20 to 27 give the order. The components `index.mdx` overview is the one exception.
20. **Start with frontmatter:** a `title` and a one-line `description`.
21. **Show the import next.** One fence that imports from the component's own subpath.
22. **Introduce the component in one or two sentences.** Say what it is and when to reach for it.
23. **Put only typing rules in `## Usage`.** Include only rules that change what a reader types.
24. **List the parts in `## Anatomy`,** in nesting order. Add the section only when the component has more than one part.
25. **Order `## Examples` by a reader's first ten uses.** Use `<Preview>` for a registered demo and a fence otherwise. Don't follow the order of Base UI's sections. A demo and its fence show the same API.
26. **Put only our props in `## Props`.** Write a table for the props ui adds or changes. For the rest, link Base UI's reference page for the component once. An unstyled pass-through part, such as a trigger or a portal, gets a line only when it behaves differently from Base UI's. Never copy Base UI's tables or prose into a page.
27. **End with `## Accessibility`.** Describe the keyboard model, focus and ARIA.
28. **Never introduce an example that the page doesn't show.**
29. **Leave the internals out.** No repo paths, generator commands, implementation history or roadmap. Keep any limit the caller hits.
30. **Follow the house style.** Sentence-case headings and straight quotes. No em dashes. No colon joining two clauses. Cut any sentence that could appear unchanged in another project's docs.
31. **Use only registered MDX components,** the ones in `services/web/src/components/mdx.tsx`.

## Before reporting done

32. **Check snippets by hand.** `pnpm --dir services/web typecheck` skips MDX and passes with a broken snippet. Check that every imported name is exported by its subpath. Check that every union in a props table is complete.
33. **Run the typecheck and the format check.**

    ```sh
    pnpm --dir services/web typecheck
    pnpm format
    ```

34. **Put a snippet check in the docs typecheck.** Nothing checks MDX snippets today. A check that returns belongs in the docs package's `typecheck` script, which CI runs. Such a check cannot judge union completeness or example order, so rules 14 and 25 still need a person.
