# UI adoption review

This records the original source review. Implementation followed afterward.

## Implementation decision

After reviewing Cursor's installed code, the user chose immediate archive removal with existing Undo, concurrent row reflow, and a moving selection background. The five-second retention proposal below was not adopted. Archive remains metadata and does not cancel running work. Torph adoption is limited to diff counts; thread titles and streaming text stay plain. Shared-wrapper and theme audit findings remain separate follow-up work.

Implemented Torph diff digits with static signs, current-value layout/accessibility, clipped exits, and no mount animation. Added token-timed sidebar selection and survivor reflow without retaining archived rows. Fixed double-failure Undo pane recovery.

Implementation checks: 27 focused tests passed, including Electron/Chromium number checks. Changed-file formatting passed. Full checks remain blocked by failures outside these changes: core lease tests, desktop workspace/composer tests, `live-display.test.ts` types, existing lint/format findings, and the main startup bundle at 960.2 KiB against a 950 KiB limit. The renderer build completed. Isolated Chromium checks covered number updates at 10% playback, signs, accessibility, zero hiding, remounts, and reduced-motion updates. Torph can finish existing short animations after reduced motion is enabled, and detached exit animations can finish briefly after unmount. No persistent resource leak was observed. Full-app visual review remains outstanding.

## Recommendation

Fix the wrapper contracts and archive recovery first. Use existing Motion for the selected-row background. Prioritize Torph for changing diff counts, then short, controlled labels. Keep thread titles and streaming content plain.

The shared kit is largely token-backed. The main problems are specific API restrictions, a few semantic-token mistakes, and desktop literals that duplicate existing tokens. This does not call for replacing our components with shadcn.

## Scope and evidence

Full source-review mode. React 19, Base UI 1.8.0, StyleX, and existing Motion 12.43.0. Tailwind is an optional shared-package consumer mapping, not the desktop styling system.

Read all shared UI component implementations, exports, styling helpers, token owners and package documentation. Compared the corresponding seven shadcn Base UI registry components and relevant installed Base UI types and implementations. Inspected desktop reusable controls, sidebar selection, archive/Undo, pane restoration, and the desktop files cited below. Other renderer files received targeted searches, not a complete screen-by-screen audit.

Torph was inspected at [commit d79a5aa](https://github.com/lochie/torph/tree/d79a5aa63226acf97d49c3e34fafb2e85c07b026), version 0.1.3. Its published npm declarations and exported diff implementation were also checked. All three supplied Vercel documents were read.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Shared components; desktop controls, prose, jobs, charts, sidebar ellipsis | Chart font-size bypass. No rendered legibility check. |
| Surfaces | Shared dialogs/menus; desktop theme owners, controls, previews and confirmations | Scoped portal inheritance and switch-thumb token issues. |
| Animations | Torph engine; Base UI tooltip delay group; sidebar, menu, tooltip, spinner and conversation styles | Concrete adoption plan below. No browser motion review. |
| Icons | Shared icon box; desktop semantic registry, panel morph, global stroke treatment | Existing currentColor and accessibility handling worth preserving. |
| Performance | Torph segmentation, reconciliation and measurements; local transitions and stable row keys | Avoid broad text morphing. No frame-time or bundle benchmark. |

## Fixes before motion

Locations below are repository-relative. Most UI wrapper findings affect the styled root exports, not the direct headless namespace exports used throughout desktop.

### Preserve Base UI behavior

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `packages/ui/src/components/ui/button.tsx:150` | A supplied `render` with no explicit type causes the wrapper to pass `type={undefined}`. Installed Base UI merges this over its safe default. | Omit an unspecified type rather than overriding Base UI's default; preserve explicit types on composed elements. | A rendered `<button />` can become a submit button inside a form. Installed-Base-UI SSR reproduced the missing attribute for element and callback composition. |
| MEDIUM | `packages/ui/src/style.ts:12`; styled component declarations listed below | Native state-based `className` and `style` callbacks are replaced with string/object-only types. The merge helper cannot evaluate callbacks. | Derive these props from each owning Base UI part and merge their results using its actual state. | Shared wrappers remove documented styling capabilities, including in unstyled mode. This is explicit API narrowing, not a claim that existing string/object props are dropped. |
| MEDIUM | `packages/ui/src/components/ui/button.tsx:36` | `[data-disabled]` always disables pointer events, including with `focusableWhenDisabled`. | Preserve hover hit testing for focusable disabled controls while Base UI suppresses activation. | Tooltip explanations cannot open on pointer hover when composed onto that node. Keyboard focus remains possible. Browser interaction remains unverified. |
| LOW | `packages/ui/src/components/ui/dropdown-menu.tsx:123` | `sideOffset?: number`. | Derive from `Menu.Positioner.Props["sideOffset"]`. | Installed Base UI accepts a number or a dimension-aware callback; the implementation already forwards the value. |

State-style narrowing affects `packages/ui/src/components/ui/` declarations in `button.tsx:127`, `input.tsx:45`, `avatar.tsx:101,134,149`, `alert-dialog.tsx:12,38,50`, `dialog.tsx:98,110,170,182`, and `dropdown-menu.tsx:119,155,180,213,257,297`.

There is no `onHandleClick` pattern in the shared kit. Its menu items preserve `onClick`, `label`, and `closeOnClick`; Input preserves `onValueChange`; direct namespace exports preserve Base UI callback details. Desktop's `components/menu.tsx:398` deliberately maps a product-level `onSelect` to `onClick`. Keep that distinction rather than mechanically renaming every app callback.

### Recovery and theme ownership

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `packages/desktop/src/renderer/src/session-actions.ts:121` | Archive, immediate Undo, then failure of both writes can leave an unarchived chat with a blank pane. | Base pane recovery on the resulting archive state, while retaining newer-selection guards. | Reproduced using the actual action, toast and pane-controller classes with failing writes. Fix before adding another archive state. |
| MEDIUM | `packages/ui/src/components/ui/dialog.tsx:123`, `alert-dialog.tsx:22`, `dropdown-menu.tsx:137` | Styled content portals to the default container, outside an app-scoped theme root. | Offer Base UI's portal-container configuration or a theme-bearing portal wrapper. | The README documents independently scoped themes. Those overrides do not inherit into body-mounted popups. Direct namespaces are an escape hatch; desktop's html-level theme is unaffected. |
| MEDIUM | `packages/desktop/src/renderer/src/components/menu.tsx:219` | Switch thumb uses `t.bgElevated`. | Use the existing `t.switchThumb`. | Dark-mode popup color is not the switch-thumb role. The settings switch already uses the correct token. |
| MEDIUM | `packages/desktop/src/renderer/src/chrome/usage-charts.tsx:114` | Axis typography uses a fixed 10px constant. | Use `t.fontXs` in both text declarations and verify tick spacing at the largest UI size. | Axes ignore the user's UI font-size preference. Installed Nivo types accept CSS font-size strings. |
| LOW | Exact-token matches listed below | Reusable shapes, gaps and short transitions repeat literal values. | Replace exact matches with existing radius, space and duration tokens; add search's reduced-motion override. | Preserve current geometry while allowing theme changes to propagate. No new token system needed. |
| LOW, product decision | `packages/desktop/src/renderer/src/theme/tokens.css:55,81,128,153,381` | Tint updates the accent owner, while semantic accent text/fill/hover remain separately blue. | Decide whether semantic actions follow tint. If yes, derive hue while preserving role-specific contrast; otherwise document fixed-blue actions. | This is a visible design-policy divergence, not a mechanical replacement to make without agreement. |

Exact-token cleanup locations under `packages/desktop/src/renderer/src/`:

- Radii: `conversation/styles.stylex.ts:107,307,362,573`, `conversation/jobs-panel.tsx:60,123,140`, `workbench/workspace-search.tsx:188`. Existing matches are `t.radiusXs`, `t.radiusSm`, `t.radiusBase`, and `t.radiusXl`.
- Shared spacing: `components/confirm-dialog.tsx:23,26,38,53`. Use existing shared 4/8/16px space tokens. Dialog-specific dimensions can remain local.
- Short transitions: `conversation/styles.stylex.ts:323,354`, `workbench/workspace-search.tsx:98`. Use `t.durationFast`; search also needs the reduced-motion override.

The ownership model is already reasonable:

```text
shared platform-tokens.stylex.ts
  → generated platform-tokens.css
  → reusable component defaults

desktop theme/tokens.css
  → vars.stylex.ts appearance handles
  → schema.stylex.ts geometry handles
  → desktop product presentation
```

Different platform and desktop defaults are allowed. Generated CSS is not a second source. A future styled-dropdown migration should first resolve the shared `--nyte-menu-max-height` name, which desktop currently redefines with a different meaning. No current styled-dropdown consumer was established.

## Thread selection and the five-second archive window

Current behavior:

```text
select thread → select/focus its pane → navigate → aria-current + selected colors
archive      → archived projection + pane removal + immediate IPC write
             → default filter removes row → grouped toast offers Undo
```

See `sidebar.tsx:189,214,282,832`, `session-actions.ts:102`, `sidebar-view.ts:194`, and `action-toasts.ts:56`, under the desktop renderer. The toast currently refreshes a roughly six-second lifetime. Deletion, unlike archive, delays irreversible work until dismissal. Do not couple these lifecycles.

I recommend interpreting the requested delay as **retaining the archived row**, not postponing persistence. That preserves the existing archive/Restore behavior, survives renderer shutdown honestly, and keeps UI timers out of core. If the write itself should wait five seconds, that is a different product decision.

```text
idle + archive A
  write immediately
  keep A in its original slot, dim its content, show Restore
  → grace until click time + 5 seconds

grace + archive B before expiry
  release A and B together, write B immediately
  → rapid mode

rapid + archive C
  release immediately; refresh one shared idle deadline

grace expires → release A → idle
rapid has no archive for 5 seconds → idle
```

The rapid-mode reset duration is a recommendation, not specified by the request. Count accepted archive changes after deduplication and no-op filtering. An explicit bulk archive skips grace immediately.

Use the existing `SessionActions` lifetime for transient interaction state and one timer. Extend its external-store snapshot because pending writes alone cannot represent retention after a successful write. Sidebar filtering bypasses only the archived exclusion for the retained row. Keep the real archived flag, other filters, stable row key and operation-version guards.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, requested behavior | `session-actions.ts:102`; `sidebar.tsx:878`; `sidebar.stylex.ts:374` | The first row disappears immediately; Archive/Pin have 16px targets. | Retain the first row for five seconds. Dim title/status/meta only. Keep Restore and its focus ring fully visible with an adequately sized, nonoverlapping target. Release a batch concurrently. | Recovery stays at the action's location; rapid archiving incurs no per-row waits. |
| LOW, requested motion | `sidebar.tsx:832`; `sidebar.stylex.ts:300` | Each row changes selected colors independently. | Trial one decorative selected-row background using existing Motion and StyleX. Update semantics immediately; keep focus on the real button. | Selection is geometry, not changing text. Keep it short, interruptible, non-bouncy, and absent on initial mount or reduced motion. |

The two rows above use desktop-renderer-relative locations.

Keep the selected indicator local to visible rows in the sidebar scroll container. Do not sweep across collapsed groups or animate toward a filtered-out row. Rapid keyboard navigation must remain immediate.

Keep existing pane removal immediate unless delayed pane closure is separately requested. Inline Restore currently does not reopen a pane; toast Undo can, subject to guards against replacing newer selections or drafts. Row expiry must not close the pane again. When the Archived filter is enabled, expiry returns the row to ordinary archived presentation rather than removing it.

Preserve existing open, drag, pin and rename actions. Retention should not restart on polling, workspace switches, collapse, Settings or sidebar hiding. Clear timers at owner disposal. Repair DOM focus only when the focused row actually disappears.

### What to borrow from Base UI tooltips

The shell already has `Tooltip.Provider delay={600} closeDelay={0} timeout={400}` at `router.tsx:85`. Installed `FloatingDelayGroup` shares an instant-open phase, one reset timer and identity guards so stale timeouts cannot reset a newer interaction.

Borrow that structure, not its internal hook or its timing values. Archive recovery is not floating-element visibility. Thread previews use PreviewCard with separate delays, so they are not governed by this Tooltip provider.

## What Torph teaches us

| Implementation evidence | Learning to adopt |
| --- | --- |
| [segment/diff](https://github.com/lochie/torph/blob/d79a5aa/packages/torph/src/lib/text-morph/utils/diff.ts), stable IDs and surviving words | Preserve identity across changes. Our rows already use session IDs; keep those keys through retention and reflow. |
| [FLIP measurements](https://github.com/lochie/torph/blob/d79a5aa/packages/torph/src/lib/utils/flip.ts), neighboring anchors | Measure before changing layout, then animate persistent items toward their new positions. Do not replace an interactive row with a visual clone. |
| [animation interruption](https://github.com/lochie/torph/blob/d79a5aa/packages/torph/src/lib/utils/animate.ts#L137) | Continue from the displayed position. An unchanged target resumes its current phase instead of repeatedly restarting a slow opening curve. Relevant to rapid selection and changing label widths. |
| [accessible text](https://github.com/lochie/torph/blob/d79a5aa/packages/torph/src/lib/text-morph/index.ts#L414), aria-hidden fragments | Expose the complete current value once, independently of visual fragments. Announcements should describe the action, not animation frames. |
| [first render and reduced motion](https://github.com/lochie/torph/blob/d79a5aa/packages/torph/src/lib/text-morph/index.ts) | Start settled and preserve a complete static experience. Do not wait for animation completion to commit application state. |

### Where to use the library itself

Diff counts are the first adoption target, ahead of the Copy label. Additional source review covered the full changes-panel, changes-stack and turn-view implementations, plus Torph's number-animation code.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW, requested motion | `packages/desktop/src/renderer/src/workbench/changes-panel.tsx:259,289`; `workbench/changes-stack.tsx:320`; `conversation/tool-group.tsx:326`; `conversation/turn-view.tsx:420` | Added/removed counts change as plain text. | Trial Torph on the Changes toolbar totals first, then visible per-file/directory and work-summary counts. Keep signs and semantic colors outside the animated digits. | Place-value matching preserves unchanged digit columns. The completed-turn card should render settled rather than animate merely because it mounted. |
| LOW, optional trial | `packages/desktop/src/renderer/src/chrome/about-dialog.tsx:135` | Plain `Copy version info` → `Copied` label inside an existing live region. | Trial Torph as a text-only child, keeping the button and live-region owner intact. Match Nyte motion policy rather than accepting the default 400ms. | A short, infrequent, controlled label tests the library without risking navigation or transcript rendering. |

Diff-count constraints:

```text
+128  −24 → +136  −24
  morph changed digits
  keep + / −, addition/removal colors and tabular numerals
  leave filenames, diff text, focus and scroll position untouched
```

- Use current formatted strings, such as `String(added)`, if formatting must stay unchanged. Numeric Torph children automatically apply locale formatting; introducing thousands separators would also change our premeasured width assumptions.
- The file rail and stacked headers reserve text width through `diffMarksWidth`. Keep a stable enclosing statistics region during the morph so digit-count changes do not overlap or repeatedly re-truncate the filename.
- Animate updates to the same file/scope identity, not unrelated files or turns when navigating. The virtualized stack remounts offscreen rows; returning to view must not replay an entrance.
- Preserve the current zero-hiding behavior. Test `0→1`, `1→0`, `9→10`, `99→100`, shrinking values and interrupted updates. Conditional unmounting can bypass a digit's exit animation.
- Keep a complete accessible additions/removals value. Do not add live announcements to every file row. Respect reduced motion and leave historical cards still on initial render.
- Torph slides entering digits from above regardless of whether the total rose or fell. It is not a directional increase/decrease indicator. Signs and labels carry that meaning.

Later candidates are a batched archive-count label or the discrete work-summary verb at `conversation/tool-group.tsx:322`. Do not animate streaming prose, editable fields, every timestamp, or every tool update.

Adoption cautions:

- Published 0.1.3 reproduces a Unicode defect. `hello 👨‍👩‍👧 world` → `hello 👨‍👩‍👦 world` makes `diffSegments` return isolated surrogate halves. Initial segmentation uses Intl.Segmenter, but later word morphing uses `split("")`. Keep arbitrary thread titles plain until this is fixed upstream and regression-tested.
- React `TextMorph` forwards `className` and `style`, not arbitrary DOM attributes or events. It rejects element children. Put accessibility semantics on a real parent, or use its hook for a custom element. Do not treat `as` as a complete polymorphic control API.
- The React adapter keeps start/complete callbacks fresh but does not similarly wrap `onAnimationCancel`; changing that callback can leave a stale closure. Never attach archive correctness to these callbacks.
- Torph measures layout, animates width/height, and installs persistent `will-change` hints. It is not compositor-only or free at list scale. Borrow its continuity rules without copying its entire engine.

## Adopt Vercel's process, not its branding

The useful distinction across the three documents is between guidance, reusable mechanics, and checks. Their public design.md is specifically for Vercel-authored reports, not a replacement desktop design system.

Proposed first step: a short Nyte `DESIGN.md`, referenced by AGENTS.md, that points to existing owners instead of duplicating token values or upstream prop tables. Document:

- Review versus implementation boundaries.
- Styled root exports versus headless subpaths and intentional product adapters.
- Theme and portal ownership, motion constraints, and legitimate numeric exceptions.
- Accepted archive timing and Restore semantics, with unresolved choices left explicit.

Keep mechanical enforcement narrow: generated-token drift, safe exact-token substitutions, and behavior tests for wrapper composition. Do not outlaw every number, custom callback or app-owned style.

Start fixed comparison fixtures with a scoped-theme popup, dark-mode menu switch, usage chart, and archive interaction. Keep inputs and viewport fixed; test light/dark, tint extremes, UI sizes 12/16, keyboard focus and reduced motion. Save a baseline, inspect the result, and turn repeated accepted corrections into guidance or checks. Do not reproduce Vercel's report layout, palette or typography.

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Shared UI and desktop | Replace all controls with shadcn or copy its classes | Base UI behavior is already mostly preserved. Keep StyleX and product geometry. Upstream shadcn's button also uses transition-all, which should not become our motion policy. |
| Desktop menu adapters | Rename all `onSelect` callbacks to `onClick` | App-level semantic adapters are intentional; they are not shared primitive contracts. |
| Sidebar archive | One timer per row, or toast-driven expiry | Both contradict the shared rapid-interaction behavior. Toast recovery and row retention have different lifetimes. |
| Conversation masks, terminal colors, icon geometry | Replace every literal with a generic theme token | Alpha masks, ANSI roles and optical corrections have different owners. No equivalent token was established. |
| Sidebar titles | Put Torph around every row/title | Selection does not change the title, and current Unicode and measurement behavior make broad adoption inappropriate. |

## Verification and implementation gates

Passed:

- `pnpm exec vitest run src/renderer/src/session-actions.test.ts src/renderer/src/layout/session-removal.test.ts src/renderer/src/chrome/sidebar-filter.test.ts`, from desktop: 20 tests.
- `pnpm --filter @nyte-ai/ui exec tsc --noEmit --incremental false`.
- `pnpm --dir ../ui check:tokens`, from desktop.
- Installed Base UI SSR comparisons reproduced the button-type issue and focusable-disabled attributes. Published Torph execution reproduced the Unicode fragmentation. A read-only action/pane fixture reproduced double-failure Undo recovery.

An additional existing failure was observed with `pnpm exec vitest run src/main/host-workspaces.test.ts`: 20 passed, 1 failed. `history survives restart while an unavailable workspace stays inactive`, at line 279, receives `requires` instead of `inactive`. This is outside the proposed UI edits; do not fold its fix into a polish patch.

Before implementation can ship, add behavior coverage for 4,999/5,000ms boundaries, second-archive flush, bulk/no-op inputs, rapid reset, stale timers, slow/failed writes, partial failures, Restore/rearchive/delete races, refetches, workspace changes, guarded pane recovery, and retained-row focus. Preserve archive-as-metadata behavior; it must not cancel running sessions.

Not verified: a running Electron/browser UI, screen readers, rendered contrast, focus movement, clipping, hit-area collisions, 10%-speed animation inspection, frame timing, or bundle size. Full-repository test, typecheck, lint and format commands were not run. No development server was started.

**Verdict: Block on the composed-button default.** The remaining findings need targeted changes, and visual/interaction verification remains outstanding. Adopt the archive behavior before adding decorative motion.

## External references

- [Torph source](https://github.com/lochie/torph)
- [Base UI composition](https://base-ui.com/react/handbook/composition), [styling](https://base-ui.com/react/handbook/styling), [Button](https://base-ui.com/react/components/button), [Tooltip](https://base-ui.com/react/components/tooltip), [Menu](https://base-ui.com/react/components/menu)
- [shadcn Base UI components](https://ui.shadcn.com/docs/components), [Button registry](https://ui.shadcn.com/r/styles/base-nova/button.json), [Dropdown Menu registry](https://ui.shadcn.com/r/styles/base-nova/dropdown-menu.json)
- [Vercel design.md](https://vercel.com/design.md)
- [How our agents build on-brand pages with design.md](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md)
- [Teaching agents product design at Vercel](https://vercel.com/blog/teaching-agents-product-design-at-vercel)
