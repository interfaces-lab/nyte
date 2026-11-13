---
name: nyte-styles
description: >
  How Nyte styles UI: the StyleX token system in packages/ui/src/styles, the cascade layers, built-in
  dark mode, appearance inputs, type and spacing scales, and the authoring invariants components
  follow. Use before writing or reviewing any StyleX `create()` in packages/ui, app, canvas, lab, or
  desktop renderer; when adding or changing a token, role, theme, or base.css rule; or when a style
  "doesn't apply", looks different in dark mode, or ignores an appearance setting. Not for the public
  site's visual direction.
paths:
  - "packages/*/src/**/*.{ts,tsx}"
contains: "@stylexjs/stylex"
---

# Nyte styles

Every visual value is a decision someone already made. Read it from a token. Add a token only when
the decision is new and reusable.

## Where to read from

Components import handles from `@nyte-ai/ui/styles/*`: `vars.stylex` (`role`, `type`, `motion`,
`shadow`, `appearance`), `schema.stylex` (geometry), `text.stylex` (whole text styles, composed
first: `props(text.sm, styles.label)`) and `hairline.stylex` (1px edges, beside the box's own style:
`props(styles.bar, hairline.blockEnd)`). The values behind them live in `theme.stylex.ts`,
`roles.stylex.ts` and `tokens.stylex.ts` in `packages/ui/src/styles/`. A hue scope comes from
`surfaceTheme` in `@nyte-ai/ui/surface-theme`. App-only structural measurements (sidebar width,
titlebar height, prose measure) live in `packages/app/src/theme/tokens.stylex.ts` and
`schema.stylex.ts`.

Native code can't read CSS variables, so `pnpm --dir packages/ui sync:tokens` generates
`platform-colors.ts` and `platform-ramps.ts`, every role and ramp step as hex, for mobile and the
docs. The design docs' Colors page renders them, so a new role or step appears there without an
edit. Renaming or deleting a role breaks those readers, so run
`pnpm --dir packages/mobile exec tsc --noEmit` after a role change.

## The cascade

From lowest to highest: user agent, `@layer base` (base.css and host resets), ui component StyleX,
app StyleX. A host declares `@layer base, priority1, … priority6;` before any sheet loads. Component
rules always beat base.css, and an app style passed through `xstyle` always beats the component's
own. `!important` in `base` beats everything above it, so it is reserved for `[hidden]` and the iOS
16px input floor.

## Invariants

Each lint rule named here explains its own fix in its message.

1. **Dark mode is built in.** Every colour role is a `light-dark()` pair, resolved by the
   `color-scheme` that `applyDisplayMode` sets. A new colour need is a new role in
   `roles.stylex.ts` plus a handle in `vars.stylex.ts`. (lint: `nyte-design/no-raw-colors`,
   `nyte-design/no-light-dark-outside-tokens`)
2. **Appearance inputs reach every surface.** The desktop writes `--nyte-font-size-base`,
   `--nyte-font-size-code`, `--nyte-font-family-*`, `--nyte-font-smoothing`, `--nyte-custom-hue`,
   and toggles transparency, cursor, and focus-modality classes on `<html>`. The canvas receives the
   same names. Derive from these and never hard-code what they control. Materials blend with
   `--nyte-reduce-transparency`. Nothing paints a page background, because the window's vibrancy
   shows through. (test: `pnpm --dir packages/app exec vitest --run style-cascade`)
3. **Text uses a whole style.** Pair size, line height, and tracking through `text.*`, or the
   `type.font*` and `type.leading*` handles together. 13px text needs at least the 16px line box
   (`text.baseCompact`). `lineHeight: 1` or `0` is for glyph boxes only. (not enforced;
   `nyte-design/no-raw-font-weight` covers weights only)
4. **Sizes come from the scale.** Rows and menu items take their height from `row`, which keeps the
   touch target. Visual size and `target.min` are separate, and the tokens grow under a coarse
   pointer, so never branch on touch by hand. (lint: `nyte-design/spacing-scale`,
   `nyte-design/size-grid`, `nyte-design/control-size`, `nyte-design/touch-in-tokens`; test:
   `pnpm --dir packages/app exec vitest --run control-targets`)
5. **A hairline never takes layout space**, so a box keeps its grid size. Draw a 1px separator or
   frame with a `hairline` style, never a 1px border or padding that makes up for one: `tableCell`
   on table cells, `controlRing` for a control's boundary, `ringAfter` for a ring above a popup's
   content. For an edge `hairline` lacks, add a variant to it. (not enforced)
   - A box takes one hairline style. It sets no `boxShadow` of its own and no property its
     forced-colors edge uses: `borderImage` with the edge styles, `outline*` with `ring` (so no
     `ring` on a box that draws its own focus outline). StyleX merges per property and ui's styles
     sit in an earlier layer than the app's, so a second hairline or the caller's value replaces
     the first.
   - A raised box sets its drop shadow as `--nyte-hairline-elevation` (registered in base.css, not
     inherited), which the shadow-drawn styles paint before their edge.
   - A style that draws on `::after` (`ringAfter`, `controlRing`, `startsAfter`, `endsAfter`,
     `pressedRing`) needs a positioned box that leaves its `::after` free.
6. **CSS owns what CSS can resolve.** Check the StyleX capability block in `packages/ui/AGENTS.md`
   before reaching for React state, effects, observers, or `requestAnimationFrame`. (partly, lint:
   `nyte-code/no-direct-effect`)
7. **Relational state stays scoped.** Parent-driven styling uses `stylex.when.*` with a marker the
   component defines, exported from a `.stylex.ts` file as `controlRoot` is, so an outer
   container's hover or focus cannot light up an inner control. (not enforced)
8. **Hover is an enhancement.** Every action stays reachable by keyboard and touch. Focus rings
   read `appearance.focusRing`, which a host clears while focus arrives by pointer. (lint:
   `nyte-design/guarded-hover`)
9. **Every wrapper has a job:** semantics, behavior or a ref, a formatting context, or spacing
   outside the child's border. A wrapper that only moves styles onto one child goes. (not
   enforced)
10. **A caller places a component; the component owns its look.** Choose its look with its props
    (`size`, `variant`, `tone`), style a wrapper you own, or add an option to the component when
    the design calls for one. Widen a contract in `packages/ui/src/styles/contracts.ts` only for a
    repeated, legitimate need. (lint: `nyte-restyle/no-restyle`)
11. **Logical properties**, except the symmetric `left: "50%"` centre. (lint:
    `nyte-design/logical-properties`)

## Colour stairs

Text, icons, fills and strokes each come in a ladder of steps called stairs, strongest first. Each
step has one job and a contrast floor that holds on every surface and its hover fill, in light,
dark and every hue scope. Pick the step for the job; never tune a colour by eye.

| Stairs | Steps (strongest first) | Jobs and floors |
| --- | --- | --- |
| Content (text and icons) | `contentPrimary`, `contentSecondary`, `contentTertiary`, `contentQuaternary`, `contentDisabled` | body and values ≥7:1; labels, nav and tool rows ≥6:1; metadata, hints and placeholders ≥4.5:1; chevrons, separators and idle glyphs, never text, ≥3:1; disabled controls only |
| Fill (translucent, over any surface) | `fillPrimary`, `fillSecondary`, `fillTertiary` | pressed fill or strong active; selected, open or pressed ghost; hover or a chip at rest |
| Stroke | `strokePrimary` (opaque), `strokeSecondary`, `strokeTertiary`, `strokeQuaternary` (translucent) | control boundary, such as a framed input's edge, ≥3:1 on any surface and its hover fill; strong or hover border; default border; hairline divider |

`contentAccent` and `strokeAccent` carry the scope's hue. Surfaces, materials, scrims and the
control and button fills sit outside the stairs.

1. **State moves up the stairs.** Hover is one step up, pressed or open two: `contentSecondary` →
   `contentPrimary`, no fill → `fillTertiary` → `fillSecondary`, `strokeQuaternary` →
   `strokeTertiary`. (not enforced)
2. **Text never fades.** If no lower step fits, the content is decoration. (lint:
   `nyte-design/no-faded-ink`)
3. **Disabled ink means disabled.** A failed or idle item that still informs uses
   `contentTertiary`, an error `contentAccent`, an idle mark `contentQuaternary`. (lint:
   `nyte-design/disabled-ink`)
4. **An icon shares its label's step.** Only decoration drops to `contentQuaternary`. (not enforced)
5. **Increased contrast moves the stairs up** and never merges two steps. Syntax colours keep 4.5:1
   on the code surfaces. (test: `pnpm --dir packages/app exec vitest --run test/tokens.test.ts`
   checks every floor and step order in both `prefers-contrast` modes)

## Adding or changing a token

1. Put the value in the right `defineVars` group and expose a handle in `vars` or `schema`.
   `createTheme` also applies its group's defaults class, so a theme re-declares every var in its
   group, not only the ones it overrides, and hides any value set on an ancestor. Give a theme a
   group of exactly the vars it changes, as `sidebarMotion` and `settingsDensity` do. Keep vars the
   app writes on `<html>` at runtime, such as the chat width and the side panel width, out of
   themed groups. `roles` is the exception: a hue scope re-resolves every role against its ramp on
   purpose.
2. Run `pnpm --dir packages/ui lock:tokens`, then review the lock diff.
3. Run `pnpm --dir packages/ui sync:tokens`. It regenerates the platform colours and ramps and the
   design-scale lint's space and box tables.

## Verify

- `pnpm --dir packages/ui typecheck` runs the token lock, the platform-colour and design-scale sync
  checks, and the StyleX capability check.
- `pnpm --dir packages/app exec vitest --run test/style-cascade.electron.test.ts` proves layer order,
  dark-mode pairs, and appearance reachability in Chromium.
- `pnpm lint` runs the `nyte-design` and `nyte-restyle` rules. Docs runs `@shadcn/lint` for its
  Tailwind classes.
- For anything a user sees, load `verify-nyte` and look at it in light and dark.
