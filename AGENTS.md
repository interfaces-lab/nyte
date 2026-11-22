# Agent guidelines

Nyte runs agent conversations on a host, a process that stores every session. The terminal client, the desktop app, the web app and the iOS app are clients of a host.

## Ground rules

- Use pnpm. Runtime versions live in `mise.toml`.
- Never start dev servers.
- Make the smallest complete fix. Leave unrelated work alone. Stage only your files.
- Prefer deletion. Add backward compatibility only when asked.
- Never `stash`, `reset`, `checkout .` or `clean`. To test without your change, revert only your files with `git diff -- <files> | git apply -R`.
- Work in the current checkout. Create a branch, worktree or PR only when asked. Then base it on `origin/main` and target `main`.
- `node_modules` is the source of truth for library types.
- No `.changeset` files or per-package changelogs. Releases follow `RELEASING.md`.
- Before adding complexity for an unlikely race or security case, tell the user the failure, its likelihood and the cost. Wait for their yes.

## Map

- Runtime dependencies point one way: `schema` → `ai` → `core` → `plugin`, `protocol` → `host` → `sdk`.
- Client code never imports `@nyte-ai/host`. That covers `@nyte-ai/sdk/client`, the TUI's client entry and the app.
- Session behaviour lives in core. A client draws what the host decided.
- The desktop app opens three kinds of window, named by `DesktopApp`. Nyte is chat first. Code is the IDE, with the workbench as its main area. Studio is the design board. The app package's AGENTS.md lists the differences.

## Guidance

- Before changing a package, read `packages/<name>/AGENTS.md` if it exists. Nothing loads it for you.
- AGENTS.md names symbols, concepts and commands, never file or folder paths. Files move, and `pnpm lint` rejects a path.
- Write guidance as short sentences, one instruction each. Add the reason when it isn't obvious.
- Don't describe how the code works. The code says that, and the description goes stale.
- When lint or a test can check a rule, put the rule there and delete the sentence.
- Put new guidance in the file that already owns the topic. Create a skill only for a distinct topic.

## Code style

- No `any` and no casts (`as T`, angle brackets). Use inference, narrowing, schema-derived types or `satisfies`. `as const` is fine. (lint: `typescript/no-explicit-any`, `typescript/consistent-type-assertions`)
- Erasable syntax only. No enums, parameter properties or namespaces. (typecheck: `erasableSyntaxOnly`)
- Top-level imports only. No dynamic imports, type-position `import()`, star imports or renamed imports. Rename only to resolve a name collision.
- One dynamic `import()` is allowed. The CLI entry router loads the command it dispatches, so a command never evaluates another command's modules.
- `const`, early returns, no `else` after a return, dot notation. (lint: `eslint/prefer-const`, `eslint/no-else-return`)
- Destructure only to unpack several values at once. A destructured parameter is one level of shorthand names, with defaults on the left and `= {}` when the parameter is optional.
- Return an object, not a tuple, when a function gives back several values, so each one has a name.
- Mark class members `private`, not `#name`. Keep `#` only on classes that extend `DurableObject`, `WorkerEntrypoint` or `RpcTarget`, because RPC callers can reach every runtime-public method. (lint: `nyte-code/no-hash-private`)
- Inline values and trivial helpers used once. Extract real operations and boundary handling. (lint, boolean helpers: `nyte-code/no-one-off-boolean-helpers`)
- No `<thing>Of` helpers such as `keyOf` or `configurationOf`. Name the operation, as `findModel` does, or inline it. (lint: `nyte-code/no-of-lookup-names`)
- Validate an unknown value once, at its boundary. Pass typed values inward.
- Annotate types only on exports and where it clarifies.
- Let an error propagate to the boundary that handles it. Avoid `try`/`catch`.
- Build arrays with `map`, `filter` and `flatMap`, not loops. Give `filter` a type guard.
- With several validation branches, the main function is the happy path. Its helpers sit below it.

## Testing

- No new tests unless asked.
- Every test protects a named contract with a credible regression. It has one owner, and it can fail.
- Test through the real API. Don't copy the implementation's logic into the test.
- Use the repo's fakes (`@nyte-ai/bench` models, `fakeHost`, `fakePorts`), not mocks or `globalThis` patches.
- Write contract tests as tables, one table across the cases. Wire formats, input validation, store migrations and packaging are contracts.
- No test-only parameters or exports in production code, such as `now`, `delay` or `budget`. Use fake timers (`vi.setSystemTime`).
- Wait for an observable state, never a fixed sleep or an elapsed-time bound.
- Advance fake timers only after the test has seen the state the timer guards. Real I/O lags behind fake time.
- No source-grep or tombstone tests that assert a file, export or feature is gone.

## Live desktop diagnostics

- Sessions run in the host. Quitting the desktop app (`pnpm install:desktop`) doesn't stop yours.
- Attach Playwright to a running desktop app with `chromium.connectOverCDP(endpoint, { noDefaults: true })`.
- Without `noDefaults`, Playwright emulates light mode while attached. A window that follows the system theme flashes light until the connection closes. The option also keeps focus and the other media preferences.
- Don't emulate a colour scheme or reduced motion on the user's live window unless asked. Use an isolated test context.

## Live TUI testing

- `pnpm dev:live [directory]` runs this checkout's TUI against the installed `nyte host`. `NYTE_BINARY` overrides the binary.
- The checkout only renders. Host, store and core changes need `pnpm install:tui` or `pnpm dev:tui`.
- Agents run it only with an isolated `HOME` and `NYTE_HOME`, as the TUI's QA service does.
- Under an isolated `HOME`, `mise` refuses to run. Resolve node first with `mise which node` and put its folder on `PATH`.

## Branches and commits

- Branch names have at most three hyphenated words, with no slashes or prefixes, as in `fix-scroll-state`.
- Commits and PR titles read `type(scope): summary`. Types: feat, fix, docs, refactor, test, perf, build, ci, chore, revert.
- Scope is a package dir or an area (`scripts`, `ci`). Omit it for repo-wide changes.
- A breaking change puts `!` before the colon and adds a `BREAKING CHANGE:` footer.
- Before committing, stage your files, then run `pnpm guidance`. It lists the AGENTS.md files and skills that cover them.
- Your change may already be in a work-in-progress sweep commit on `main`. Never reset, amend or rewrite it. Review it with `git show <sha> -- <files>`.
- Check `git log -- <file>` before waiting on another chat's file.

## Verification

- One package: `pnpm --dir packages/<package> test`.
- Full check: `pnpm check` runs format, lint and typecheck. Docs only: `pnpm exec turbo typecheck --filter=@nyte-ai/web`.
- `pnpm lint` checks types too. While iterating, check only what you touched with `pnpm exec oxlint --type-check <files>`.
- Add a lint rule to `nyteRules`, the Nyte rule preset. The root oxlint config holds plugins, import boundaries and per-package exceptions. A new rule is an error, not a warning. Oxlint's category defaults stay off, so an upgrade adds no rule unseen.
- Lint runs on `tsrs`, a Rust port of TypeScript 7. `tsc`, each package's `typecheck` script, is the source of truth, and the merge queue runs it.
- When `tsrs`, the editor or a type-aware lint rule disagrees with `tsc`, reproduce with the package's `typecheck` script. A `tsrs` disagreement is a `tsrs` bug. Report it with a minimal repro.
- After changing `@nyte-ai/schema` wire types or core's stored `*Record` schemas (`HeadRecord`, `SessionRecord`), run `pnpm --dir packages/host check:store`. Backfill what it reports.
- After changing what a client receives over the wire, run `pnpm --dir packages/bench bench:wire:gate`.
- After changing how a tool call snapshots its workspace (`SnapshotsApi`, `localSnapshots`), run `pnpm --dir packages/bench bench:snapshots:gate`.
- After changing a `ServerSpec` or how the host talks to language servers, run `NYTE_LANGUAGE_DOWNLOADS=1 pnpm --dir packages/host test language-matrix`. Without the variable a fixture runs only when its servers are already installed.
- A language fixture's matrix records which servers offer each feature and whether its probes got an answer. Change a row only to what the run showed.
- Pin a server's download with the host's `pin-language-server` script. It prints the sha256 of each URL, or writes an npm tarball list.
- Report failures in unrelated files. Don't fix them.
- Before changing Turborepo config, read the docs that ship inside the installed `turbo` package.
