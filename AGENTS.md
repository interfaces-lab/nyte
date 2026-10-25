# Agent Guidelines

- Use pnpm. Runtime versions live in `mise.toml`.
- Never start dev servers.
- Make the smallest complete fix. Leave unrelated work alone. Stage only your files.
- To test without your change, revert only your files (`git diff -- <files> | git apply -R`) or use `git worktree add`. Never `stash`, `reset`, `checkout .` or `clean`.
- Add backward compatibility only when asked.
- `node_modules` is the source of truth for library types.
- Before changing a package, read `packages/<name>/AGENTS.md` if it exists. It isn't loaded for you.
- Base branches, worktrees and diffs on `origin/main`; PRs target `main`.
- No `.changeset` files or per-package changelogs. Releases follow `RELEASING.md`.
- Runtime dependencies point one way: `schema` → `ai` → `core` → `plugin`, `protocol` → `host` → `sdk`. Client code (`@nyte-ai/sdk/client`, the TUI's `src/index.ts`, the app) never imports `@nyte-ai/host`.
- Before adding complexity for an unlikely race or security case, explain the failure, its likelihood and the cost, and get the user's buy-in.

## Code style

- No `any` and no casts (`as T`, angle brackets). Use inference, narrowing, schema-derived types or `satisfies`. `as const` is fine.
- Erasable syntax only: no enums, parameter properties or namespaces.
- Top-level imports only. No dynamic, type-position `import()`, star or renamed imports, except to resolve a name collision.
- `const`, early returns, no `else` after a return, dot notation, no destructuring.
- Inline values and trivial helpers used once. Extract real operations and boundary handling.
- No `<thing>Of` helpers (`keyOf`, `configurationOf`). Name the operation (`findModel`) or inline it.
- Validate unknown values once, at their boundary, and pass typed values inward.
- Annotate types only on exports and where it clarifies.
- Let errors propagate to the boundary that handles them instead of `try`/`catch`.
- `map`, `filter` and `flatMap` with type-guard filters over loops that build arrays.
- With several validation branches, the main function is the happy path and helpers sit below it.
- Prefer deletion. Comment only non-obvious constraints.

## Testing

- No new tests unless asked.
- Test through the real API; don't copy the implementation's logic into the test.
- Use the repo's fakes (`@nyte-ai/bench` models, `fakeHost`, `fakePorts`), not mocks or `globalThis` patches.

## Live TUI testing

- `pnpm dev:live [directory]` runs this worktree's TUI against the installed `nyte host` (`NYTE_BINARY` overrides the binary). The worktree only renders; host, store and core changes need `pnpm install:nyte` or `pnpm dev:tui`.
- Agents run it only with an isolated `HOME` and `NYTE_HOME`, as `qa/service.ts` does.

## Branches and commits

- Branch names: at most three hyphenated words, no slashes or prefixes (`fix-scroll-state`).
- Commits and PR titles: `type(scope): summary`. Types: feat, fix, docs, refactor, test, perf, build, ci, chore, revert. Scope is a package dir or area (`scripts`, `ci`), omitted for repo-wide changes. Breaking: `!` before the colon and a `BREAKING CHANGE:` footer.

## Verification

- Package: `pnpm --dir packages/<package> test`.
- Full check: `pnpm check` (format, lint, typecheck). Docs only: `pnpm exec turbo typecheck --filter=@nyte-ai/web`.
- After changing `packages/schema` wire types or `packages/core/src/contract/records.ts`, run `pnpm --dir packages/host check:store` and backfill what it reports.
- Report failures in unrelated files; don't fix them.
- Before changing Turborepo config, read the installed `turbo` package's `docs/`.
