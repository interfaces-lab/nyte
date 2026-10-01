# Page contract

Every page holds the same order, so a reader learns the shape once.

1. Frontmatter `title` and `description`. One short line, no colon mid-sentence.
2. Import block. Show the component's individual subpath in one fence.
3. One or two sentences on what it is and when to reach for it.
4. `## Usage`, only rules that change what a reader types.
5. `## Anatomy`, the parts in nesting order. Skip it for a single element.
6. `## Examples`, `<Preview>` where a demo exists, code fences otherwise.
7. `## Props`, our props as a table, then `<include>` per Base UI part.
8. `## Accessibility`, the keyboard model, focus behavior, and ARIA. Terse.

Where a part passes through Base UI with no styling of its own, such as a trigger or a portal, say so
in one line and skip its styled props table.

## What belongs

Tables and code. A reader scans for the prop, the key, or the shape of the tree.

## What does not

- Repo paths, generator commands, which file consumes the component.
- Rationale for the implementation, history, known gaps, roadmap notes.
- Meta-commentary about the documentation itself.
- Bolded **must** and **must not**, "is a defect". State the rule plainly.
- Prose introducing an example that is not on the page. This was the single largest defect when
  the pages were first written, because the generator stripped Base UI's live demos and left
  their introductions behind.

## Voice

Sentence case headings. Straight quotes. No em dashes, use a period or a comma. No colons as
mid-sentence connectors. Active voice. One idea per sentence. No closing pep talk. If a sentence
could appear unchanged in another project's docs, cut it.

## Components

Only `<Preview>`, `<TokenTable>`, `<include>`, and demos registered in
`packages/docs/src/components/cloud/mdx.tsx`. A demo and the code fence beside it must agree. When
they disagree, one of them is lying to the reader, and it is usually the fence.
