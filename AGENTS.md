# Agent Guidelines

Use pnpm. Runtime versions live in `mise.toml`.

Leave dev servers to the user. Build and test commands target individual packages.

Prefer the smallest complete fix. Leave unrelated work alone.

Add backward compatibility only when requested.

## Commits and PR titles

Use `type(scope): summary` for commit subjects and PR titles. Omit the scope for changes spanning the repository.

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, and `revert`.

Scope is an existing Nyte package directory such as `core`, `tui`, `desktop`, `plugin`, or `docs`. For changes outside packages, use the repository area such as `scripts` or `ci`.

Examples: `fix(core): preserve tool errors`, `docs: clarify repository instructions`, `fix(tui): restore scroll position`.

Add a body when the reason or migration needs explanation. Mark breaking changes with `!` before the colon and a `BREAKING CHANGE:` footer.

Stage only files that belong to the requested change.

## Code Style

- **Do not use** `any` **or type casts, including** `as T`**, chained assertions, and angle-bracket assertions**. Use inference, narrowing, schema-derived types, or `satisfies`. `as const` preserves literals and is allowed.
- Use code in `node_modules` as code source of truth for type inference
- RMust use erasable syntax. No enums, parameter properties, or namespaces in package source, tests, or demo source.
- Imports must be top-level, including `import type`. No dynamic imports, type-position `import()`, star imports, or renamed imports. A type alias import is allowed only to resolve a name collision.
- Inline trivial one-use helpers. Extract meaningful operations and complex boundary handling.
- **Prefer** `const`**, early returns, and dot notation.** Names explain the concept. 
- **Prefer deletion.** When asked to refactor or improve, look for removals before additions.
- **Prefer** `no-comments` **and** `no-tests`



## Verification

Choose checks relevant to the change.

- Package tests, when the package defines a test script: `pnpm --dir packages/<package> test`.
- The docs site uses `pnpm --dir packages/docs types:check`. Root `pnpm typecheck` does not include it.
- Workspace checks: `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm format:fix` applies formatting. Report failures without fixing unrelated files.

