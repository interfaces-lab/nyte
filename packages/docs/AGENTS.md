<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Docs

- Load `.agents/skills/component-docs` before touching anything under `content/cloud`, before
  changing what `@nyte-ai/ui` exports, and before citing a component page as the answer to a
  question. The pages are the team's reference for the package, so a wrong example becomes a
  wrong commit.
- `content/base-ui-reference` is generated. Edit `scripts/sync-base-ui-reference.mjs`, never the
  files, and pull the tables into a page with `<include>`.
- `content/docs/design.mdx` is the core design record, not component documentation. It outranks
  every other page on runtime contracts.
