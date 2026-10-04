# Long-form pages

Two kinds of page: reference docs, which say what is true, and essays (the ethos and the
manifesto), which say what we believe and why.

## Reference docs

Docs render through `DocArticle` in `src/app/(site)/_layout/article.tsx`: eyebrow, title, lede,
prose, pager, and an on-this-page rail.

- The lede is the frontmatter `description`: one sentence saying what the reader can do after
  reading.
- State contracts as present-tense rules. Keep shipped behaviour apart from proposals (see
  `packages/docs/AGENTS.md`).
- Show real artifacts before diagrams: TUI captures under `/tui/`, code from the tree, and the
  landing host components.

## Essays

Studied on poolside.ai/vision/purpose, /vision/research, and their blog, October 2026.

What Poolside does:

- Vision is its own section with two essays under one title, switched by folder tabs.
- Each essay is dated (ISO date, mono, top right) and bylined with name and role.
- A table of contents sits beside the prose.
- Purpose runs from what they believe about the future, to why their path leads there, to a
  sequence ("Step one, two, three"), to "strong beliefs, weakly held", to who they are.
- Research opens with its founding belief, lists the core beliefs, then gives each a section.
- Posts embed real artifacts, such as agent transcripts rendered as product UI, with captions.

What we take:

- A belief stated plainly, then the evidence or the mechanism behind it.
- Dates and bylines; an essay is a position someone holds at a time.
- A visible sequence when we describe a path.
- Real Nyte artifacts in place of illustrations.

What we leave:

- AGI framing and claims about the future of humanity. Nyte's essays stay about how agents
  should run and how we build them.

Where the essays live, and their layout, are open. See [coverage-gaps.md](coverage-gaps.md).
