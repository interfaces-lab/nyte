# TUI

- Terminal rendering and keyboard interaction live here; session behavior belongs in core, and the client fold in `@nyte-ai/client`.
- The screen is a Solid component (`src/app/App.tsx`) painted from the UI store in `src/app/ui.ts`. Feature code changes state through `setUi`, `notice`, `setHints`, `patchStatus`, `openPanel`; it never sets a renderable's content. Leaf widgets that only draw (transcript view, pickers, gutter) stay renderables and are mounted where the store says.
- `bun test src` renders the screen under OpenTUI's test renderer and asserts frames; `bun scripts/build-binary.ts` compiles with the Solid plugin through `Bun.build`; from source, `src/binary.ts` installs the same transform before loading the app.
- Reusable shortcuts and displayed keycaps are defined in `src/constants.ts`; reference named actions from production and QA.
- QA launches the compiled Nyte binary in a real PTY and observes it with OpenTUI's `EmbeddedTerminalRenderable`.
- Assert visible screens, provider requests, task/process outcomes, and clean exit output. Do not import the application controller into QA.
- The terminal driver and isolated loopback fixtures live in `qa/`. Record input-to-matching-screen latency per action.
- Cover relevant widths, scrolling, resize, and cancellation. Wait for observable states with deadlines; close every process, PTY, renderer and fixture.
- The store runs in a worker thread (`WorkerStore` over core's `store-worker`), so the rendering thread never waits on SQLite. `scripts/build-binary.ts` compiles the worker as a second entry from `packages/`; `src/host.ts` opens it at `/$bunfs/root/core/src/kernel/store-worker.js` in the binary and from source beside `WorkerStore`.
- Each workspace has one store for every client at `~/.nyte/workspaces/<path-hash>/sessions.db` (`workspaceStorePath` in `@nyte-ai/host`). The TUI attaches as runner only to sessions it opened; children follow their parent.
- Every local input paints before host work starts: notices for stop and task actions, selected model and effort, and the composer's own text. Keys are blocked with a reason until the session is open.

## Verification

From the repository root:

- Screen rendering tests, then build and binary QA: `pnpm --dir packages/tui run test`.
- Focus a run: `pnpm --dir packages/tui run test --filter models`.
- Visible PTY playback: `pnpm --dir packages/tui run test:show --filter models`.
- Check source and QA types: `pnpm --dir packages/tui typecheck`.

Both QA modes run the binary, not an in-process reconstruction. Results and input/output evidence
are saved under the printed temporary run directory. A matching emulated screen does not prove
physical terminal scanout, OS clipboard behavior, or image-protocol display.
