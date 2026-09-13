<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# Nyte

- Use pnpm. Runtime versions live in `mise.toml`.
- Leave dev servers to the user. Build and test commands target individual packages.
- Keep replies short and plain; diagrams help when they clarify something.

## Instructions and documentation

- Read this file and any `AGENTS.md` in the ancestor directories of files you change. More specific instructions govern their subtree; keep repository-wide rules here.
- Read the affected package's README before changing it. Use [CONTRIBUTING.md](CONTRIBUTING.md) for the package map and development workflow.
- Add a nested `AGENTS.md` only for package-specific constraints or checks. Link to existing explanations instead of repeating parent instructions or architecture docs.
- Keep setup, usage, and package overviews in READMEs; keep agent working rules in `AGENTS.md`. Update the relevant documentation when commands, behavior, or package boundaries change.
- Keep generated instruction blocks intact. Put handwritten guidance outside their markers.

## Changes

- Preserve unrelated work and behavior. Prefer the smallest complete fix.
- Check before removing intentional functionality outside the requested scope.
- Add backward compatibility only when requested.
- Check installed dependency APIs when needed. Update outdated dependencies rather than dropping functionality to fit them.
- Work directly by default. Use subagents for substantial, independent tasks with clear scopes; synthesize their findings yourself.
- Keep delegation prompts short: identify the task, owned files, and authoritative reference. Do not pre-defend the current implementation or repeat the whole conversation.
- Join an existing task when its result becomes necessary; use foreground execution when no join tool exists. Review required results and verify changes before calling the parent task complete.
- Never run `git stash`; other agents edit this tree at the same time and a stash reverts their work.

## Commits and PR titles

- Use `type(scope): summary` for commit subjects and PR titles. Omit the scope for changes spanning the repository.
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, and `revert`.
- Use an existing Nyte package directory as the scope, such as `core`, `tui`, `desktop`, `plugin`, or `docs`. For changes outside packages, use the affected repository area, such as `scripts` or `ci`. Do not copy scope names from another repository.
- Write a short, imperative summary in lowercase, with no trailing period. Describe the change: `fix(core): preserve tool errors`, `docs: clarify repository instructions`, `fix(tui): restore scroll position`.
- Add a body when the reason or migration needs explanation. Mark breaking changes with `!` before the colon and explain them in a `BREAKING CHANGE:` footer.
- Keep each commit focused. Inspect the diff and stage only files or hunks belonging to the requested change; do not include unrelated work.

## Code

- External input must be parsed at its boundary; trust parsed types internally.
- Do not use `any` or type casts, including `as T`, chained assertions, and angle-bracket assertions. Use inference, narrowing, schema-derived types, or `satisfies`. `as const` preserves literals and is allowed.
- Root-checked TypeScript must use erasable syntax. No enums, parameter properties, or namespaces in package source, tests, or demo source.
- Imports must be top-level, including `import type`. No dynamic imports, type-position `import()`, star imports, or renamed imports. A type alias import is allowed only to resolve a name collision.
- Inline trivial one-use helpers; extract meaningful operations and complex boundary handling.
- Prefer `const`, early returns, and dot notation. Names must explain the concept; comments must explain constraints and reasons, not visible control flow.

## Verification

Choose checks relevant to the change:

- Package tests, when the package defines a test script: `pnpm --dir packages/<package> test`.
- Check the package's `package.json` and local instructions for additional checks. The docs site uses `pnpm --dir packages/docs types:check`; root `pnpm typecheck` does not include it.
- Workspace checks: `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm format:fix` applies formatting. Report failures without fixing unrelated files.
- Markdown files are excluded from the formatter. Review their layout and local links, and check changed-file whitespace with `git diff --check`.
