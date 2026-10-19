# Agent Guidelines

- Use pnpm. Runtime versions live in `mise.toml`.
- Never start dev servers; leave them to the user.
- Build and test individual packages, not the whole repo.
- Make the smallest complete fix. Leave unrelated work alone. Stage only files for this change.
- To test without your change, revert only your files (`git diff -- <files> | git apply -R`) or use `git worktree add`. Never `stash`, `reset`, `checkout .` or `clean`: they take everyone's uncommitted work with them.
- Add backward compatibility only when requested.
- Core contracts: JSDoc on `@nyte-ai/core` exports and `packages/lab/sdk-shape.ts`.
- Treat `node_modules` as the source of truth for library types.

## Code style

- No `any` and no type casts (`as T`, chained or angle-bracket assertions). Use inference, narrowing, schema-derived types, or `satisfies`. `as const` is fine.
- Erasable syntax only: no enums, parameter properties, or namespaces.
- Top-level imports only, including `import type`. No dynamic, type-position `import()`, star, or renamed imports (except to resolve a name collision).
- Prefer `const`, early returns, and dot notation. Names explain the concept.
- No `<thing>Of` helpers (`keyOf`, `childOf`, `configurationOf`). Name the operation (`findModel`, `readChild`) or inline the expression: an `Of` name hides how a value is found and how that fails.
- Inline trivial one-use helpers; extract real operations and boundary handling.
- Prefer deletion. Prefer no comments and no new tests unless asked.

## Commits and PR titles

`type(scope): summary`. Types: feat, fix, docs, refactor, test, perf, build, ci, chore, revert.
Scope is a package dir (`core`, `tui`, `desktop`, ...) or area (`scripts`, `ci`); omit it for repo-wide changes.
Add a body when the reason needs explaining. Breaking: `!` before the colon plus a `BREAKING CHANGE:` footer.

## Verification

- Package: `pnpm --dir packages/<package> test`.
- Stored shapes (`packages/schema` wire types, `packages/core/src/contract/records.ts`): `pnpm --dir packages/host check:store [path]` reads a real store (default `~/.nyte/nyte.db`) with the working-tree validators. Backfill what it reports before committing.
- Workspace: `pnpm typecheck`, `pnpm lint`, `pnpm format` (`format:fix` to apply). Docs only: `pnpm exec turbo typecheck --filter=@nyte-ai/web`.
- Report failures in unrelated files; don't fix them.
- Turborepo varies by version: read the installed `turbo` package's `docs/` before changing its config.

## Skills

Skills live in `.agents/skills`. Load the one that fits the task:
- `nyte-styles` before writing or reviewing StyleX, tokens, or base.css.
- `verify-nyte` and `browser` to prove UI changes in the web and desktop apps.
- `typescript-best-practices`, `review-code-quality`, and `principle-*` for code and review.
- `better-writing` and `unslop` for prose.
