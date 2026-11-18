# Agent Guidelines

- Use pnpm. Runtime versions live in `mise.toml`.
- Never start dev servers.
- Make the smallest complete fix. Leave unrelated work alone. Stage only your files.
- To test without your change, revert only your files (`git diff -- <files> | git apply -R`). Never `stash`, `reset`, `checkout .` or `clean`.
- Add backward compatibility only when asked.
- `node_modules` is the source of truth for library types.
- Before changing a package, read `packages/<name>/AGENTS.md` if it exists. It isn't loaded for you.
- AGENTS.md names symbols, concepts and commands, never file or folder paths: files move. `pnpm lint` rejects a path.
- Put new guidance in the file that already owns the topic; create a skill only for a distinct topic.
- Work in the current checkout. Create a branch, worktree or PR only when asked; then base it on `origin/main` and target `main`.
- No `.changeset` files or per-package changelogs. Releases follow `RELEASING.md`.
- Runtime dependencies point one way: `schema` → `ai` → `core` → `plugin`, `protocol` → `host` → `sdk`. Client code (`@nyte-ai/sdk/client`, the TUI's client entry, the app) never imports `@nyte-ai/host`.
- Before adding complexity for an unlikely race or security case, explain the failure, its likelihood and the cost, and get the user's buy-in.

## Code style

- No `any` and no casts (`as T`, angle brackets). Use inference, narrowing, schema-derived types or `satisfies`. `as const` is fine. (lint: `typescript/no-explicit-any`, `typescript/consistent-type-assertions`)
- Erasable syntax only: no enums, parameter properties or namespaces. (typecheck: `erasableSyntaxOnly`)
- Top-level imports only. No dynamic, type-position `import()`, star or renamed imports, except to resolve a name collision. The one dynamic `import()` allowed is the CLI entry router loading the command it dispatches, so a command never evaluates another command's modules.
- `const`, early returns, no `else` after a return, dot notation, no destructuring.
- Inline values and trivial helpers used once. Extract real operations and boundary handling. (lint, boolean helpers: `nyte-code/no-one-off-boolean-helpers`)
- No `<thing>Of` helpers (`keyOf`, `configurationOf`). Name the operation (`findModel`) or inline it. (lint: `nyte-code/no-of-lookup-names`)
- Validate unknown values once, at their boundary, and pass typed values inward.
- Annotate types only on exports and where it clarifies.
- Let errors propagate to the boundary that handles them instead of `try`/`catch`.
- `map`, `filter` and `flatMap` with type-guard filters over loops that build arrays.
- With several validation branches, the main function is the happy path and helpers sit below it.
- Prefer deletion.

## Testing

- No new tests unless asked.
- Every test protects a named contract with a credible regression, has one owner, and can fail.
- Test through the real API; don't copy the implementation's logic into the test.
- Use the repo's fakes (`@nyte-ai/bench` models, `fakeHost`, `fakePorts`), not mocks or `globalThis` patches.
- Write contract tests (wire formats, input validation, store migrations, packaging) as tables: one table across the cases, not one test per case.
- No test-only parameters or exports in production code (`now`, `delay`, `budget`). Use fake timers (`vi.setSystemTime`).
- Wait for an observable state, not a fixed sleep or an elapsed-time bound. Advance fake timers only after the test has seen the state the timer guards: real I/O lags behind fake time.
- No source-grep or tombstone tests that assert a file, export or feature is gone.

## Live desktop diagnostics

- Sessions run in the host, so quitting the desktop app (`pnpm install:desktop`) doesn't stop yours.
- To attach Playwright to a running desktop app, use `chromium.connectOverCDP(endpoint, { noDefaults: true })`. Without `noDefaults`, Playwright applies light-mode media emulation while attached, so a window that follows the system theme flashes light until the connection closes. The option also keeps focus and the other media preferences as they were.
- Don't emulate a colour scheme or reduced motion on the user's live window unless asked; use an isolated test context for those cases.

## Live TUI testing

- `pnpm dev:live [directory]` runs this checkout's TUI against the installed `nyte host` (`NYTE_BINARY` overrides the binary). The checkout only renders; host, store and core changes need `pnpm install:tui` or `pnpm dev:tui`.
- Agents run it only with an isolated `HOME` and `NYTE_HOME`, as the TUI's QA service does.
- Under an isolated `HOME`, `mise` refuses to run. Resolve node first with `mise which node` and put its folder on `PATH`.

## Branches and commits

- Branch names: at most three hyphenated words, no slashes or prefixes (`fix-scroll-state`).
- Commits and PR titles: `type(scope): summary`. Types: feat, fix, docs, refactor, test, perf, build, ci, chore, revert. Scope is a package dir or area (`scripts`, `ci`), omitted for repo-wide changes. Breaking: `!` before the colon and a `BREAKING CHANGE:` footer.
- Before committing, stage your files, then run `pnpm guidance`.
- Your change may already be in a work-in-progress sweep commit on `main`. Never reset, amend or rewrite it; review it with `git show <sha> -- <files>`. Check `git log -- <file>` before waiting on another chat's file.

## Verification

- Package: `pnpm --dir packages/<package> test`.
- Full check: `pnpm check` (format, lint, typecheck). Docs only: `pnpm exec turbo typecheck --filter=@nyte-ai/web`.
- `pnpm lint` checks types too: oxlint runs its type-aware rules and TypeScript's errors in one pass on `tsrs`, a Rust port of TypeScript 7. While iterating, check only what you touched: `pnpm exec oxlint --type-check <files>`.
- `tsc` (TypeScript 7, each package's `typecheck` script) is the source of truth for types, and the merge queue runs it before anything reaches main. When `tsrs`, the editor or a type-aware lint rule disagrees with it, reproduce with the package's `typecheck` script; a `tsrs` disagreement is a `tsrs` bug, reported with a minimal repro.
- After changing `@nyte-ai/schema` wire types or core's stored record types (`HeadRecord`, `SessionRecord` and the other `*Record` schemas), run `pnpm --dir packages/host check:store` and backfill what it reports.
- After changing what a client receives over the wire, run `pnpm --dir packages/bench bench:wire:gate`.
- After changing how a tool call snapshots its workspace (`SnapshotsApi`, `localSnapshots`), run `pnpm --dir packages/bench bench:snapshots:gate`.
- Report failures in unrelated files; don't fix them.
- Before changing Turborepo config, read the docs that ship inside the installed `turbo` package.
