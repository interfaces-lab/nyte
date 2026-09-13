# Nyte rendering and scrolling compared with opencode2

## Current status

Nyte now uses the relevant opencode2 interaction ideas without replacing Nyte's transcript model or patching OpenTUI.

| Component | Nyte | Pinned opencode2 reference |
| --- | --- | --- |
| OpenTUI core | Stock 0.5.11 | Stock 0.5.10 |
| Transcript window | Estimated heights, exact text anchors, bounded mounted window | Contiguous tail-first row slice |
| Turn navigation | Stable logical turn key plus temporary tail space | Stable message ID plus temporary tail space |
| Wheel default | Fixed three rows, acceleration optional | Fixed three rows, acceleration optional |
| Footer layout | Disjoint transcript, latest, composer, and ephemeral rows | Disjoint stacked rows |

The old `@opentui/core` patch is gone from `pnpm-workspace.yaml` and `pnpm-lock.yaml`. The patch files were deleted. No replacement patch, cast, private-field access, prototype change, vendored runtime, fake resize, or suspend cycle was added.

The resolved local binary is Nyte 0.0.2. Matching installed Nyte docs were not present at the npm, native-cache, or native-installer candidates. Checkout files were used as project source, not as a substitute installed-path contract.

## Reference identity

This comparison uses only `anomalyco/opencode`'s `v2` branch at commit [`872e38055e728d6f4865dc2b9c1c5e55fe9579e2`](https://github.com/anomalyco/opencode/tree/872e38055e728d6f4865dc2b9c1c5e55fe9579e2). The checkout is `/tmp/nyte-opencode-v2.p1SfJO/opencode`.

There is no `packages/opencode2`. [`packages/cli/bin/opencode2.cjs`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/cli/bin/opencode2.cjs) reaches [`packages/cli/src/commands/handlers/default.ts`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/cli/src/commands/handlers/default.ts#L60-L114), which runs `@opencode/tui`. That full-screen TUI is the reference. The separate mini command uses native terminal scrollback and is not the target.

The reference files were read but its dependencies and tests were not run in Nyte.

## Adopted behavior

### Logical turn navigation

The old `TranscriptView.jumpTurn()` chose every target from physical `scrollTop`. Near the tail, `scrollTo()` could clamp without moving. Repeated Ctrl+Down calls then selected the same turn while returning success.

`TranscriptView` now keeps the selected turn's stable item key. The next keypress advances from that key rather than recomputing from a clamped offset. A temporary bottom spacer makes a short transcript or tail turn physically alignable. Wheel input, page input, session reset, and return-to-latest cancel that navigation state and drop the spacer to zero rows. A resize keeps the selected turn: its anchor is restored at the same screen row and the spacer is recomputed for the new viewport.

Two one-frame glitches in the first implementation were found with a frame-by-frame probe and fixed. A root mounted outside a frame reads height 0 until Yoga measures it, which shifted every offset below it for one frame on Ctrl+Up. Slack was also computed against a `scrollHeight` that still contained the previously requested spacer rows. Both now read the last Yoga pass: unmeasured roots keep their estimate, and slack subtracts the spacer's computed layout height.

A rendered-frame regression test (`every painted frame of a jump shows the selected turn at its settled row`) replaced that probe. It records every frame the public renderer paints for twelve presses away from and back to the tail and requires each one to show the settled turn at the settled row. Writing it exposed three more requested-versus-measured mismatches, now fixed in the same way:

- After a wheel step shorter than the tail slack, `finishManualScroll` compared `scrollTop` with a `scrollHeight` that still held the cancelled spacer, so the view stopped at the natural bottom in history mode with the latest control showing. `atBottom()` and `slackForTarget()` now share one natural content height (scrollHeight minus the spacer's measured height) and `atBottom()` adds the requested slack, so a short wheel step returns to following and a longer one keeps history.
- The `LAYOUT_CHANGED` hook applied index/row anchors from the estimated prefix offsets. An overscan turn mounted above the target that measured taller than its estimate pushed the target one row for one frame. Index anchors now use the mounted root's Yoga position in-frame, the way text anchors already did.
- `reconcileWindow` skipped a spacer write when the wanted height equaled the spacer's last laid-out height, but OpenTUI's `height` getter returns the laid-out value while the setter dedupes on the requested one. When `beforeFrame` re-mounted a turn against a still-clamped `scrollTop`, the spacer kept the stale request and the frame carried nine phantom rows, which fed back into the slack and clamped the next frame to the previous turn. The write is now unconditional.

Removing any one of those four guards makes the frame test fail on a wrong row or wrong turn.

This ports the concepts from OpenCode's [message navigation](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/message-navigation.ts#L8-L47) and [session integration](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/index.tsx#L594-L659). It does not port OpenCode's row reducer or history coordinator.

### Follow latest and read history

The main transcript has two explicit modes:

```text
follow latest
  output grows -> keep the tail above the composer
  reader scrolls up -> read history

read history
  output grows -> keep the same text offset on the same screen row
  resize or disclosure changes -> restore the exact text anchor
  Ctrl+End or latest control -> follow latest
```

The visible latest action uses `chat.scroll.latest` from the shared constants and keymap. It appears only while reading history. Plain Up and Down remain composer caret and prompt-history keys. Ctrl+Up and Ctrl+Down remain turn-navigation keys.

Relevant Nyte files:

- `packages/tui/src/transcript.ts`
- `packages/tui/src/app/App.tsx`
- `packages/tui/src/constants.ts`
- `packages/tui/src/interactive.ts`

OpenCode's comparable ownership and latest-control code is in [`routes/session/index.tsx`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/index.tsx#L452-L527) and [the latest row](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/index.tsx#L1326-L1345).

### Wheel policy

The transcript moves exactly three rows for each ordinary wheel event by default. `/scroll-acceleration on` selects OpenTUI's `MacOSScrollAccel`; `/scroll-acceleration off` restores the fixed step. The boolean `scrollAcceleration` setting is parsed at the settings-file boundary, merges through global and workspace settings, appears in `/settings`, and persists through the existing settings store.

Each scroll box that uses the setting gets its own acceleration object, so timing history is not shared between viewports.

Relevant files:

- `packages/tui/src/scrolling.ts`
- `packages/tui/src/settings.ts`
- `packages/tui/src/settings.test.ts`
- `packages/tui/src/app/App.tsx`
- `packages/tui/src/diagnostic-report.ts`
- `packages/tui/src/task-browser.ts`
- `packages/tui/src/usage-panel.ts`

The pinned reference's policy is [`packages/tui/src/util/scroll.ts`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/util/scroll.ts#L3-L28).

### Disjoint footer rows

Nyte no longer cancels the ephemeral slot's height with a negative transcript margin. Yoga lays out the regions as ordinary siblings:

```text
transcript
latest row
live column
  plugin rows
  pending gutter
  task status
  composer and status rule
  attachment preview
  notice, completion, or picker rows
hints
```

The transcript viewport shrinks when the live column grows. Its existing text anchor restores historical content after that layout change. Pinned content remains above the composer. Plugin rows, attachment previews, the pending gutter, task status, full-screen views, overlays, focused descendants, and selected transcript ranges keep their existing owners and mounting rules.

OpenCode's comparable stack is in [`routes/session/index.tsx`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/index.tsx#L1267-L1415).

### Nyte virtualization stays

Nyte still models the complete transcript with estimated heights, prefix offsets, measured blocks, overscan, and top and bottom spacers. It retains mounted items needed by the visible window, the live tail, focus, or selection. The measurement cache remains bounded.

This is intentionally different from OpenCode's initial 40-row tail and 60-row reveal chunks in [`routes/session/index.tsx`](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/index.tsx#L121-L123) and its [history coordinator](https://github.com/anomalyco/opencode/blob/872e38055e728d6f4865dc2b9c1c5e55fe9579e2/packages/tui/src/routes/session/history.ts#L1-L58). Nyte has no matching paginated-history boundary, and its exact text-offset anchor is stronger than OpenCode's message ID and screen coordinate.

## Stock OpenTUI repaint boundary

OpenTUI 0.5.11 exposes `requestRender()`, not `requestFullRepaint()`. Nyte now relies on normal renderable dirtiness, OpenTUI's stock `SIGWINCH` handling, and supported focus restoration. Plugin reload requests a normal render after reconciliation.

The removed patch also clipped `OptimizedBuffer.fillRect()` and changed the editor's fixed 1 MiB text-read limit. Neither change was recreated elsewhere. The current build runs against the installed stock package.

A normal state change or delivered resize can repaint changed cells. Nyte cannot guarantee repair of arbitrary bytes written over the screen by another process when OpenTUI's current and previous buffers are otherwise equal. Upstream 0.5.11 has no public full-damage invalidation API. The implementation does not claim that unsupported case is fixed.

The pinned opencode2 full-screen setup also has no focus or `SIGWINCH` force-repaint workaround. Its external editor path suspends and resumes around an intentional terminal ownership handoff. Nyte does not use that ownership cycle for ordinary focus or resize events.

## PTY QA corrections

The binary QA now passes the terminal options inline to `Bun.spawn`. With Bun 1.4.2 on macOS, handing spawn a pre-created `Bun.Terminal` left the supervisor without a controlling terminal or foreground process group. Inline creation delivers PTY resize notifications and `SIGWINCH`. The existing supervisor still owns process-group cleanup, and query replies still flush as soon as the terminal transport is available.

The driver also waits for a complete child synchronized-update frame before accepting a matching screen. Plain exit output counts as a complete terminal update. This prevents a test from sending the next key after only the first changed row of a frame arrived, which previously produced mixed old and new footer observations in the emulator.

## Regression coverage

`packages/tui/src/transcript-view.test.ts` mounts the real `TranscriptView` under OpenTUI's test renderer. Its assertions cover visible text, screen rows, scroll movement, selection text, focus, and layout rectangles. Diagnostic counts are used only for the bounded-window and temporary-space resource contracts.

The source cases cover:

- short and tail-clamped logical turn navigation, including repeated end calls
- navigation cancellation by page, wheel, reset, and latest; navigation survival across resize
- a wheel step shorter than the tail slack lands on the natural bottom and follows new output; a longer step keeps history
- every painted frame of twelve navigation presses away from and back to the tail shows the settled turn at the settled row
- streaming while reading history and while pinned
- the latest keyboard and mouse actions
- Markdown, code fences, tool disclosure, combining characters, CJK, and emoji reflow
- selection across multiple virtual windows and resize
- disjoint notice, completion, picker, latest, and composer rectangles
- exact three-row wheel movement without taking composer focus
- bounded mounted items and measurement cache size

The compiled-binary cases in `packages/tui/qa/cases.ts` cover long held streaming, page and wheel input, a historical screen-row anchor, width reflow, focus restoration, draft and cursor retention, completion and settings pickers, one footer, return to latest, composer history, and repeated short, wide, and restored resizes.

## Verification

Completed locally with Bun 1.4.2, Nyte 0.0.2, and stock OpenTUI 0.5.11, after the review cleanup:

- `pnpm --dir packages/tui typecheck`: passed.
- `pnpm --dir packages/tui exec bun test src`: 48 passed. Frame-by-frame assertions run for every observed frame, so the assertion count varies with scheduling.
- `pnpm --dir packages/tui build`: passed (binary sha256 `04150f4fd665a20c8d5d2d459aa833d71e2b8f725a5b9d98101d17f23f2c0341`).
- Focused binary `rendering.resize-and-focus`: passed.
- Focused binary `rendering.history-stream-and-popups`: passed.
- Full compiled-binary QA: all 7 cases passed.

The earlier missing `question` tool was a QA fixture dependency-loading failure, not a missing core feature. QA already installed the exported question example as a project plugin, but the compiled loader could not resolve its `typebox` dependency through the workspace symlink. The fixture now bundles that public example and its dependencies, leaving `@nyte-ai/plugin` external so it uses the binary's host API. No core tool was restored and no user plugin was loaded or changed.

Once that fixture loaded, the journey exposed two observation errors: a scrollbar cell was being compared as bash output, and the resume paging helper stopped when the requested text appeared even though the text it needed to hide was still visible. The assertions now exclude the scrollbar column and page until the complete expected screen is reached. Their original output and resume requirements remain intact.

Latest full-run evidence:
`/var/folders/70/ll0pwzzn4m74dxzp5kp26mx80000gn/T/nyte-terminal-qa-mlxptm/report.json`.

Latest focused evidence:

- `/var/folders/70/ll0pwzzn4m74dxzp5kp26mx80000gn/T/nyte-terminal-qa-d3C91T/report.json`

These tests observe a real compiled Nyte process through a real PTY and an emulated terminal. They do not prove physical terminal scanout, OS clipboard behavior, image-protocol display, every terminal emulator, or repair of arbitrary externally injected screen damage.

The first-frame navigation regression covers repeated moves through a measured tail window. Highly irregular, not-yet-measured turns between a navigation target and the tail remain a coverage gap: estimated heights can still affect slack before their first layout. The tests do not establish first-frame alignment for every such estimate.

## Choices not adopted

- The mini interface's native scrollback and split footer
- OpenCode's Effect application architecture
- OpenCode's row reducer and pagination coordinator
- A downgrade to OpenTUI 0.5.10
- Dependency or runtime patching
- Private renderer flags or prototype changes
- Fake resize, suspend and resume, periodic clearing, or a fixed repaint loop
- A 60 FPS cap without a separate latency decision
