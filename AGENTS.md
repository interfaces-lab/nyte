# Nyte

- Use pnpm. Runtime versions live in `mise.toml`.
- Leave dev servers to the user. Build and test commands target individual packages.
- Keep replies short and plain; diagrams help when they clarify something.

## Changes

- Preserve unrelated work and behavior. Prefer the smallest complete fix.
- Check before removing intentional functionality outside the requested scope.
- Add backward compatibility only when requested.
- Check installed dependency APIs when needed. Update outdated dependencies rather than dropping functionality to fit them.
- Work directly by default. Use subagents for substantial, independent tasks with clear scopes; synthesize their findings yourself.
- Never run `git stash`; other agents edit this tree at the same time and a stash reverts their work.

## Code

- External input must be parsed at its boundary; trust parsed types internally.
- Do not use `any` or type casts, including `as T`, chained assertions, and angle-bracket assertions. Use inference, narrowing, schema-derived types, or `satisfies`. `as const` preserves literals and is allowed.
- Root-checked TypeScript must use erasable syntax. No enums, parameter properties, or namespaces in package source, tests, or demo source.
- Imports must be top-level, including `import type`. No dynamic imports, type-position `import()`, star imports, or renamed imports. A type alias import is allowed only to resolve a name collision.
- Inline trivial one-use helpers; extract meaningful operations and complex boundary handling.
- Prefer `const`, early returns, and dot notation. Names must explain the concept; comments must explain constraints and reasons, not visible control flow.

## Verification

Choose checks relevant to the change:

- Package tests: `pnpm --dir packages/<package> test`.
- Workspace checks: `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm format:fix` applies formatting. Report failures without fixing unrelated files.
