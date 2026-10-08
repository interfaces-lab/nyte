# TUI

- Terminal rendering and keyboard interaction live here; session behavior belongs in core, and the client fold in `@nyte-ai/client`.
- The screen is a Solid component (`src/app/App.tsx`) painted from the UI store in `src/app/ui.ts`. Feature code changes state through `setUi`, `notice`, `setHints`, `patchStatus`, `openPanel`; it never sets a renderable's content. Leaf widgets that only draw (transcript view, pickers, gutter) stay renderables and are mounted where the store says.
- `bun scripts/build-binary.ts` compiles with the Solid plugin through `Bun.build`; from source, `src/binary.ts` installs the same transform before loading the app.
- Reusable shortcuts and displayed keycaps are defined in `src/constants.ts`; reference named actions from production and QA.
- The package's tests are two scenarios in `qa/`, both against the compiled binary: `headless` (piped CLI, `-p`/`--json`) and `tui` (a real PTY observed with OpenTUI's `EmbeddedTerminalRenderable`). Add coverage as a named step in one of them, not as a new suite.
- Assert visible screens, provider requests, task/process outcomes, and clean exit output. Do not import the application controller into QA.
- The terminal driver and isolated loopback fixtures live in `qa/`. Record input-to-matching-screen latency per action.
- Cover relevant widths, scrolling, resize, and cancellation. Wait for observable states with deadlines; close every process, PTY, renderer and fixture.
- SQLite runs through `WorkerStore`; usage history runs through the host package's shared `UsageScanWorker`. Both stay off the rendering thread. `scripts/build-binary.ts` embeds their entries under `/$bunfs/root/core/src/kernel/store-worker.js` and `/$bunfs/root/host/src/usage-worker.js`; source runs load the corresponding `.ts` files.
- Each workspace has one store for every client at `~/.nyte/workspaces/<path-hash>/sessions.db` (`workspaceStorePath` in `@nyte-ai/host`). The TUI attaches as runner only to sessions it opened; children follow their parent.
- Every local input paints before host work starts: notices for stop and task actions, selected model and effort, and the composer's own text. Keys are blocked with a reason until the session is open.

## Verification

From the repository root:

- Build, then both scenarios: `pnpm --dir packages/tui run test`.
- One scenario: `pnpm --dir packages/tui run test --scenario headless` or `--scenario tui`.
- Visible PTY playback of `tui`: `pnpm --dir packages/tui run test:show` (add `--step` to advance with Enter).
- Check source and QA types: `pnpm --dir packages/tui typecheck`.
- QA needs ripgrep 12 or later on PATH.

Every mode runs the binary, not an in-process reconstruction. Results and input/output evidence
are saved under the printed temporary run directory. A matching emulated screen does not prove
physical terminal scanout, OS clipboard behavior, or image-protocol display.
