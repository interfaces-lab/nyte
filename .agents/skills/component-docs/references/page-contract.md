# Page contract

Component pages hold this order. The components `index.mdx` is an overview and is exempt.

1. Frontmatter `title` and a one-line `description`.
2. One fence importing from the component's own subpath.
3. One or two sentences on what it is and when to reach for it.
4. `## Usage`, only rules that change what a reader types.
5. `## Anatomy`, the parts in nesting order, when there is more than one.
6. `## Examples`, `<Preview>` where a demo is registered, fences otherwise. Order them by what a
   reader needs in their first ten uses, not by Base UI's sections.
7. `## Props`, our props as a table, then an `<include>` per Base UI part, with the MIT attribution
   line.
8. `## Accessibility`, the keyboard model, focus and ARIA.

A part that passes through Base UI unstyled, such as a trigger or a portal, gets one line saying so
and no table of ours. Its `<include>` stays. Never copy Base UI's prose.

Keep out repo paths, generator commands, implementation history and roadmap. A limit the caller
hits stays in. Never introduce an example that isn't on the page.

Sentence case headings, straight quotes, no em dashes, no colon joining two clauses. Cut a sentence
that could appear unchanged in another project's docs.

Use only MDX components registered in `packages/docs/src/components/mdx.tsx`. A demo and the fence
beside it show the same API.
