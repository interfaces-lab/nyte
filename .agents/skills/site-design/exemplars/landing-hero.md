# Exemplar: the landing hero, October 2026

Files: `components/landing/plate/plate-hero.tsx`, `host-stage.tsx`, `fact-word.tsx`,
`nav-sentinel.tsx`, and `components/site-nav/site-nav.tsx`.

## What we kept and why

- **The plate, "Agent, deploy anywhere.", and the pill buttons.** The user called these the
  part worth keeping when two heroes were merged.
- **The preview from the Poolside-style draft.** A flat panel with a dock beat the segmented tabs
  above the preview: the control sits where the change happens.

## What we rejected

- **A subhead that listed the hosts** ("in the terminal, the desktop app, or on your phone"). It
  read like a spec sheet and undersold a kernel that runs in more places. Replaced with three
  fact words: git, on your laptop, at the edge.
- **Host names in the headline that also switched the preview.** Two controls for one state.
  The dock alone switches it.
- **A moon hero kept unused in the tree.** Deleted with its CSS and its two dependencies.

## Mistakes to avoid

- The pinned nav kept white text when the light preview scrolled under it. Fixed with
  `NavSentinel` and the `stuck:` state.
- Passing a render function from a server component to a client component. Pass nodes.
- Fact pills that the source does not back. Each pill in the hero has a row in
  [../references/copy.md](../references/copy.md).
