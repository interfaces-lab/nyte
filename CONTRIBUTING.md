# Contributing to Nyte

## Setup

On macOS or Ubuntu with Node installed, run this in the folder that should hold the checkout:

```sh
npx nyte-ai init
```

The command clones `interfaces-lab/nyte` into `./nyte` if you are in the `interfaces-lab` organization, and forks it if you aren't. It installs the Xcode Command Line Tools on macOS or the system packages on Ubuntu, plus `gh` and mise, when they're missing. It hands the GitHub login to `gh`. Then it installs Node, pnpm and bun with mise, installs dependencies and builds the terminal client once. It shows the whole plan and asks once before it changes anything.

You can run it again at any time. It skips the steps that are done and continues a run that failed. To print the plan without changing anything, run:

```sh
npx nyte-ai init --check
```

Without `CENTRAL_LICENSE_KEY`, Central Icons don't install and the apps draw Lucide icons instead. See [Icons](packages/docs/content/design/foundations/icons.mdx).

Runtime versions live in [mise.toml](mise.toml), and [package.json](package.json) pins the pnpm version. Use pnpm for workspace commands.

To start a client, run one of these:

```sh
pnpm dev:tui
pnpm dev:desktop
```

To start the documentation site, run `pnpm --dir packages/docs dev`. Agents leave dev servers to the user.

## Packages

| Package | Responsibility |
| --- | --- |
| [ai](packages/ai/README.md) | Provider streaming, authentication and model catalog |
| [schema](packages/schema) | Shared data schemas |
| [core](packages/core/README.md) | Durable sessions, execution, storage and session views |
| [protocol](packages/protocol/README.md) | Wire operations, schemas and SSE framing |
| [host](packages/host/README.md) | Node host, listener, stores and local workspace |
| [service](packages/service) | The local host process that `nyte host` and the desktop app run |
| [sdk](packages/sdk) | `sdk.open` and `sdk.connect`, the one API every client uses |
| [plugin](packages/plugin) | Plugin contracts (`/core`, `/client`), supplied plugins and renderers |
| [cli](packages/cli/README.md) | npm distribution and installer for the Nyte binary |
| [tui](packages/tui/README.md) | Terminal client and native binary |
| [desktop](packages/desktop/README.md) | Electron desktop client |
| [app](packages/app/README.md) | React interface for the desktop and web clients |
| [canvas](packages/canvas) | Inline canvases: the `nyte/canvas` kit and the runtime every client loads it in |
| [vt](packages/vt/README.md) | Terminal emulation over Ghostty's libghostty-vt WebAssembly build |
| [mobile](packages/mobile/README.md) | Native iOS companion for a remote host |
| [connect](packages/connect/README.md) | The Nyte Connect contract for account-based remote access |
| [connect-broker](packages/connect-broker/README.md) | The Nyte Connect broker, a Cloudflare Worker |
| [tailnet](packages/tailnet/README.md) | `nyte-tailnet`, the host's embedded Tailscale node |
| [ui](packages/ui/README.md) | Shared UI components and design tokens |
| [bench](packages/bench/README.md) | Test fixtures: scripted models, cassettes, scenarios and a host simulation |
| [docs](packages/docs/README.md) | Documentation website and design system reference |
| [examples](packages/examples) | Small programs built on the SDK |

Read the affected package's README for details. Before you edit, read the root `AGENTS.md` and every `AGENTS.md` above the files you change. `pnpm guidance` lists those files and the skills that apply to your change.

## Verification

Build and test the affected package with the scripts its `package.json` defines:

```sh
pnpm --dir packages/core test
pnpm --dir packages/core typecheck
pnpm --dir packages/desktop build
```

Run tests from a package. The root `test` script only prints that instruction and fails. Some packages, including `ui` and `docs`, have no test script. To test the TUI's compiled binary, run `pnpm --dir packages/tui test:binary`. See the TUI's [verification instructions](packages/tui/AGENTS.md#verification).

Run the repository checks with `pnpm check`. It runs `pnpm format`, `pnpm lint`, `pnpm typecheck` and `pnpm operations`. `pnpm typecheck` includes the docs site, which builds its workspace dependencies, such as `ui`, before it typechecks. To check only the docs site and its dependencies, run:

```sh
pnpm exec turbo typecheck --filter=@nyte-ai/web
```

The formatter skips `.md` files, so `pnpm format` doesn't check READMEs or agent instructions. `pnpm lint` runs `node scripts/check-agents.mjs`, which checks that relative Markdown links resolve and that no `AGENTS.md` names a file path. For a Markdown-only edit, run that script and `git diff --check`. Build or typecheck the site when you change MDX or site code.

`pnpm format:fix` formats the whole repository. To format only the files you edited, run `pnpm exec oxfmt <file> ...`. Keep unrelated changes as they are, and report failures outside your change.

## Commits and pull requests

Write commit messages as `type(scope): summary`, for example `fix(core): preserve tool errors` or `docs: clarify repository instructions`. The scope names a package directory or a repository area. Leave it out for repository-wide changes. [AGENTS.md](AGENTS.md#branches-and-commits) has the full convention.

In the pull request, explain the problem, the resulting behavior and how you checked it. Include screenshots for visible UI changes when they help. Keep each change focused, and stage only its files or hunks.

## Vercel deployments

Run the Vercel CLI from the repository root. On a fresh checkout, link the existing projects:

```sh
vercel link --repo --scope interface-co
vercel
```

Select `nyte-app`, `nyte-labs` or `nyte-web` in the project picker. Don't link a single project at the repository root, because `.vercel/project.json` overrides the repository picker in `.vercel/repo.json`. Git pushes don't deploy these projects. Deploy them with the CLI.

| Vercel project | Root directory | Framework |
| --- | --- | --- |
| `nyte-app` | `packages/app` | Vite |
| `nyte-labs` | `packages/lab` | Vite |
| `nyte-web` | `packages/docs` | TanStack Start |

All three projects read source files outside their root directory. Each needs the shared `CENTRAL_LICENSE_KEY` to install Central Icons. Without it, the deployment draws Lucide icons. `.vercelignore` excludes local artifacts, secrets and unrelated demos and keeps the shared workspace dependencies. Vercel detects pnpm and the workspace build graph.

To deploy one project without the picker, run:

```sh
vercel --project nyte-app --scope interface-co
```

Deployments are previews by default. Add `--prod` to update production. To inspect the upload contents without deploying, run:

```sh
vercel deploy --dry --project nyte-app --scope interface-co --json
```

The app also needs `VITE_NYTE_CLERK_PUBLISHABLE_KEY` and `VITE_NYTE_CONNECT_ORIGIN` in the target deployment environment. Labs deploys as a static site, so the `/core` server routes that its dev server serves don't exist in a deployment.
