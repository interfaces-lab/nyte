# Desktop E2E

Playwright tests for the built Electron app (`out`), configured in `playwright.config.ts`. Each spec launches the desktop over a temp `HOME` and walks one surface.

## Chapters

| File | Covers |
| --- | --- |
| `first-run.spec.ts` | An empty home: new chat, nothing listed |

Closing a chapter's desktop fails if any process of its tree, the Nyte Host utility process or a child it spawned included, is still running 5 s after Electron quits. `stores/` is a separate suite with its own `playwright.config.ts`.

## Prerequisites

```sh
pnpm --dir packages/canvas build
pnpm --dir packages/app build
pnpm --dir packages/desktop build
```

## Run

```sh
pnpm e2e:desktop                       # builds the canvas shell, the app and the desktop first
```

One chapter, against an existing build:

```sh
pnpm --dir packages/desktop exec playwright test --config e2e/playwright.config.ts e2e/first-run.spec.ts --reporter=list
```

Each chapter records a trace per test; after a failure, `test-results/<test>/error-context.md` holds the accessibility snapshot at the failing step. Results land in `e2e/test-results/` and `e2e/playwright-report/`.
