# @nyte-ai/web

The Nyte documentation site. Content lives in `content/docs`. The [design record](content/docs/design.mdx)
is the contract; other pages describe what shipped.

`content/cloud` is Cloud, the design system, served at `/cloud/introduction`. Its `headless/`
pages and `content/base-ui-reference/` are vendored from Base UI's MIT-licensed docs by
`pnpm sync:base-ui`; `pnpm check:base-ui` fails when they drift. Live primitive examples compile
`@nyte-ai/ui` through StyleX (`.babelrc.json` + `@stylexjs/postcss-plugin` in
`postcss.config.mjs`); the `@stylex;` marker in `src/app/global.css` is where the rules land.

```bash
pnpm --dir packages/docs dev
```

Open http://localhost:3000. The desktop client uses root `pnpm dev:desktop`.

## Explore

- `src/lib/source.ts`: Content collections and source adapters.
- `src/lib/docs-nav.ts` / `src/lib/cloud-nav.ts`: Page trees for the docs and Cloud sidebars.
- `src/lib/site-sections.ts`: Featured Docs and Cloud destinations in the site nav.

Fumadocs is kept for MDX collections, the page tree, and search indexing (`fumadocs-mdx`, `fumadocs-core`). The default Fumadocs UI theme is not loaded.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `src/app/(site)/(landing)` | Landing page. |
| `src/app/(site)/docs` | Core docs shell: site nav, sidebar, and MDX map. |
| `src/app/cloud` | Cloud design system. Same site nav, own sidebar and article. |
| `src/app/api/search/route.ts` | Search handler. |

### Fumadocs MDX

Collections are defined with the [Macro API](https://fumadocs.dev/docs/mdx/macro) in `src/lib/source.ts`. Global MDX options live in `source.config.ts`.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Verification

From the repository root:

```sh
pnpm --dir packages/docs types:check
pnpm --dir packages/docs build
```

The root `pnpm typecheck` does not run this package's `types:check` script. Read [AGENTS.md](AGENTS.md) before changing site code.

## Deploying

Create or link the `nyte-web` Vercel project under `interface-co`, attach `nyte.sh`, and set
**Root Directory** to `packages/docs`. Vercel detects the Turborepo monorepo and
the Next.js app from that project root, so there is no checked-in `vercel.json`
overriding its install, build, output, or ignored-build settings.

The root `.vercelignore` excludes unrelated workspaces, generated binaries,
and local Nyte state. A root `vercel` command uploads `packages/docs`, its
`@nyte-ai/ui` workspace dependency, and the root metadata needed to install it.

`@nyte-ai/core` cannot reach the client bundle because it is not in this
package's dependency graph.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
