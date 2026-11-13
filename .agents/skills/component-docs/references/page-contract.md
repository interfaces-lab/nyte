# Page contract

One page per component subpath. None for style, asset, helper or engine subpaths (`diffs`, `trees`,
`highlights`, `worker-pool`, `code-themes`) or the app's or desktop's own components.

Component pages, except the components `index.mdx` overview, hold this order:

1. Frontmatter `title` and a one-line `description`.
2. One fence importing from the component's own subpath.
3. One or two sentences: what it is, when to reach for it.
4. `## Usage`: only rules that change what a reader types.
5. `## Anatomy`: parts in nesting order, if more than one.
6. `## Examples`: `<Preview>` for a registered demo, else a fence, ordered by a reader's first ten
   uses, not Base UI's sections. A demo and its fence show the same API.
7. `## Props`: our props table, then an `<include>` per Base UI part with the MIT attribution line.
   An unstyled pass-through part (trigger, portal) gets one line saying so and its `<include>`, no
   table of ours and none of Base UI's prose.
8. `## Accessibility`: keyboard model, focus, ARIA.

Never copy Base UI's prose or introduce an example the page doesn't show. Leave out repo paths,
generator commands, implementation history and roadmap; keep a limit the caller hits. Sentence-case
headings, straight quotes, no em dashes, no colon joining two clauses. Cut any sentence that could
appear unchanged in another project's docs. Use only MDX components registered in
`packages/docs/src/components/mdx.tsx`.
