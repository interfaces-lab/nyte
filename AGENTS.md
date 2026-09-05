# Nyte

- Use pnpm. Runtime versions live in `mise.toml`.
- Never run `pnpm dev`, including package-level dev scripts. 
- Keep replies short and plain. Use the `show-me` skill  when explaining.
  
## Changes

- Read affected files in full before editing or making broad conclusions.
- Make the smallest complete fix. Preserve unrelated work and behavior.
- Ask before removing functionality or code that appears intentional, unless its removal is already authorized.
- Do not add backward compatibility unless requested.
- Check installed dependency types in `node_modules` instead of guessing APIs. Do not remove functionality to accommodate outdated dependencies; update the dependency instead.

## Code

- Validate unknown input at its owning boundary; trust parsed values internally.
- Avoid `any`. Derive types from their owner and rely on inference where clear.
- Use only erasable TypeScript syntax in code checked by the root config: `packages/*/src`, `packages/*/test`, and `packages/demo/*/src`. No enums, parameter properties, namespaces, or other syntax requiring JavaScript emit.
- Use top-level imports, including `import type`. No dynamic imports or type-position `import()`.
- Do not use star imports or rename imports. An aliased type import is permitted only to resolve an unavoidable name collision.
- Inline simple helpers with one caller. Extract complex boundary handling or a meaningful operation; keep supporting helpers near their caller.
- Prefer `const`, early returns, and dot notation over unnecessary reassignment, `else`, or destructuring.
- Keep names that explain a concept; inline trivial values used once.
- Comment on non-obvious constraints and reasons, not visible control flow.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format
```

`pnpm format` checks formatting; `pnpm format:fix` applies it.
