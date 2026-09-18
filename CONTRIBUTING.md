# Contributing to Nyte

## Setup

From the repository root:

```sh
mise install
pnpm install
```

Runtime versions live in [mise.toml](mise.toml); the pnpm version is pinned in [package.json](package.json). Use pnpm for workspace commands.

To start a client yourself, run `pnpm dev:tui` or `pnpm dev:desktop`. The documentation site uses `pnpm --dir packages/docs dev`. Agents leave dev servers to the user.

## Packages

| Package | Responsibility |
| --- | --- |
| [ai](packages/ai/README.md) | Provider streaming, authentication, and model catalog |
| [schema](packages/schema) | Shared data schemas |
| [core](packages/core/README.md) | Durable sessions, execution, storage, and client state |
| [protocol](packages/protocol/README.md) | Wire operations, schemas, and SSE framing |
| [client](packages/client/README.md) | HTTP client for the wire protocol |
| [server](packages/server/README.md) | HTTP request handler over the core SDK |
| [host](packages/host/README.md) | Model and plugin composition, workspace trust |
| [plugin](packages/plugin) | Plugin contract and built-ins; see [examples](packages/plugin/examples/README.md) |
| [cli](packages/cli/README.md) | npm distribution and installer for the Nyte binary |
| [tui](packages/tui/README.md) | Terminal client and native binary |
| [desktop](packages/desktop/README.md) | Electron desktop client |
| [mobile](packages/mobile/README.md) | Native iOS companion for a remote host |
| [ui](packages/ui/README.md) | Shared UI components and design tokens |
| [telemetry](packages/telemetry/README.md) | Runtime telemetry |
| [docs](packages/docs/README.md) | Documentation website and design system reference |
| [demo](packages/demo) | Website and server deployment examples |

Read the [design record](packages/docs/content/docs/design.mdx) for architecture and the affected package's README for details. Read root and ancestor `AGENTS.md` files before editing. Package instructions currently live in [core](packages/core/AGENTS.md), [desktop](packages/desktop/AGENTS.md), [tui](packages/tui/AGENTS.md), [mobile](packages/mobile/AGENTS.md), and [docs](packages/docs/AGENTS.md).

## Verification

Build and test the affected package using scripts it defines in `package.json`:

```sh
pnpm --dir packages/core test
pnpm --dir packages/core typecheck
pnpm --dir packages/desktop build
```

There is no root `test` script. Some packages, including schema and UI, have no test script. The TUI test command also builds and runs binary QA; see its [verification instructions](packages/tui/AGENTS.md#verification).

Repository checks are `pnpm typecheck`, `pnpm lint`, and `pnpm format`. The docs site needs a separate `pnpm --dir packages/docs types:check` because its script has a different name. For a Markdown-only edit, review layout and local links and run `git diff --check`; build or typecheck the site when MDX or site code changes.

`pnpm format:fix` formats the whole repository. The formatter excludes `.md` files, so `pnpm format` does not validate READMEs or agent instructions. For supported files, limit formatting to your edits with `pnpm exec oxfmt <file> ...`. Preserve unrelated changes and report failures outside your scope.

## Commits and pull requests

Use `type(scope): summary`, for example `fix(core): preserve tool errors` or `docs: clarify repository instructions`. The scope names an existing Nyte package directory or repository area and is optional for repository-wide changes. The full convention lives in [AGENTS.md](AGENTS.md#commits-and-pr-titles).

Explain the problem, the resulting behavior, and how you checked it. Include screenshots for visible UI changes when useful. Keep each change focused and stage only its files or hunks.
