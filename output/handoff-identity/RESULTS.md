# Handoff identity races — results

Scoped diff: `output/handoff-identity/revision.diff` (pre = file before this change, now = current;
concurrent edits by other agents in the same files are excluded).

## Checks run

| Check | Result | Log |
| --- | --- | --- |
| `pnpm --dir packages/protocol test` + `typecheck` | 4 files, 95 tests pass; tsc clean | `protocol-test.txt` |
| `pnpm --dir packages/core typecheck` | clean | `core-test.txt` |
| `pnpm --dir packages/core test` | all pass except `client-session-waiting.test.ts` (1 failure from a concurrent `parked`/`waitingCall` rewrite in `session-state.ts`, not this change) | `core-test.txt` |
| `bun test src/sent-messages.test.ts` (tui) | 15 pass | `tui-sent-messages-test.txt` |
| `bun test --preload session-follower-shim.ts src/pending-gutter.test.ts src/sent-messages.test.ts` | 20 pass (rendering: block identity via `item.key`) | `tui-render-test-with-shim.txt` |
| `pnpm --dir packages/tui typecheck` | 19 pre-existing errors: `SessionFollower` → `SessionObserver` rename and `SessionState.waiting` removal in core, not yet followed by `interactive.ts` / `tasks.ts` / `task-browser.ts` / `transcript.ts`; none in changed files | `tui-typecheck-preexisting-errors.txt` |
| `pnpm --dir packages/desktop typecheck` + `live-fold.test.ts` | clean, 16 pass | `desktop-check.txt` |
| `pnpm --dir packages/client test` | 23 pass | `client-test.txt` |
| `pnpm lint` | no findings in changed files; failures only under `output/` from earlier work | — |

## Blocked

The TUI binary build and PTY QA (`pnpm --dir packages/tui run test`) cannot run: the tree's core
`SessionFollower` → `SessionObserver` rename has not reached the TUI, so the binary fails at import.
The shim in this directory is test-only and was never placed in the tree.
