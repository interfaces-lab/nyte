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

Read every visual value from a token. Add a token only for a new, reusable decision.

## Where to read from

Import handles from `@nyte-ai/ui/styles/*`:

- `vars.stylex`: `role`, `type`, `motion`, `shadow`, `appearance`.
- `schema.stylex`: geometry.
- `text.stylex`: whole text styles, composed first: `props(text.sm, styles.label)`.
- `hairline.stylex`: 1px edges, beside the box's own style: `props(styles.bar, hairline.blockEnd)`.

Values live in `theme.stylex.ts`, `roles.stylex.ts` and `tokens.stylex.ts` in
`packages/ui/src/styles/`. `surfaceTheme` (`@nyte-ai/ui/surface-theme`) makes a hue scope. App-only
measurements, such as the sidebar width, live in `packages/app/src/theme/tokens.stylex.ts` and
`schema.stylex.ts`.

## The cascade

Lowest to highest: user agent, `@layer base` (base.css, host resets), ui component StyleX, app
StyleX, so an app's `xstyle` beats the component's own style. A host declares
`@layer base, priority1, … priority6;` before any sheet loads. `!important` in `base` beats all of
them; use it only for `[hidden]` and the iOS 16px input floor.

## Invariants

A rule with no lint or test named is not enforced.

- Colours are roles, each a `light-dark()` pair resolved by the `color-scheme` that
  `applyDisplayMode` sets. A new colour is a role in `roles.stylex.ts` plus a handle in
  `vars.stylex.ts`. (lint: `nyte-design/no-raw-colors`, `no-light-dark-outside-tokens`)
- Derive from the appearance inputs the desktop and the canvas set, and never hard-code what they
  control: `--nyte-font-size-base`, `--nyte-font-size-code`, `--nyte-font-family-*`,
  `--nyte-font-smoothing`, `--nyte-custom-hue`, and the transparency, cursor and focus-modality
  classes on `<html>`. Materials blend with `--nyte-reduce-transparency`. Paint no page background;
  the window's vibrancy shows through. (test: `style-cascade`, under Verify)
- Text takes `text.*`, or `type.font*` with `type.leading*`. 13px text needs at least the 16px line
  box (`text.baseCompact`). `lineHeight: 1` or `0` is for glyph boxes only. (lint covers weights
  only: `nyte-design/no-raw-font-weight`)
- Rows and menu items take their height from `row`, which keeps the touch target. Visual size and
  `target.min` are separate tokens that grow under a coarse pointer; never branch on touch by hand.
  (lint: `nyte-design/spacing-scale`, `size-grid`, `control-size`, `touch-in-tokens`; test:
  `pnpm --dir packages/app exec vitest --run control-targets`)
- Draw a 1px separator or frame with a `hairline` style, which takes no layout space, never a 1px
  border or compensating padding. `tableCell` goes on table cells, `controlRing` on a control's
  boundary, `ringAfter` for a ring above a popup's content. Add a missing edge as a `hairline`
  variant.
  - One hairline style per box, with no `boxShadow`, no `borderImage` beside an edge style and no
    `outline*` beside `ring` (their forced-colors edges), so no `ring` on a box that draws its own
    focus outline. StyleX merges per property and ui's layer sits below the app's, so a second
    hairline or a caller's value silently replaces the first.
  - A raised box puts its drop shadow in `--nyte-hairline-elevation` (registered in base.css, not
    inherited), which the shadow-drawn styles paint before their edge.
  - `ringAfter`, `controlRing`, `startsAfter`, `endsAfter` and `pressedRing` draw on `::after`, so
    the box must be positioned and leave `::after` free.
- CSS owns what CSS can resolve. Read the StyleX capability block in `packages/ui/AGENTS.md` before
  reaching for React state, effects, observers or `requestAnimationFrame`. (partly:
  `nyte-code/no-direct-effect`)
- Style from a parent with `stylex.when.*` and a marker the component exports from a `.stylex.ts`
  file, as `controlRoot` is, so an outer container's hover or focus can't light up an inner
  control.
- Hover only enhances; every action stays reachable by keyboard and touch. Focus rings read
  `appearance.focusRing`, which a host clears while focus arrives by pointer. (lint:
  `nyte-design/guarded-hover`)
- A wrapper needs a job: semantics, behavior or a ref, a formatting context, or spacing outside the
  child's border. Delete one that only moves styles onto its child.
- A caller places a component; the component owns its look. Use its props (`size`, `variant`,
  `tone`), style a wrapper you own, or add an option to the component. Widen a contract in
  `packages/ui/src/styles/contracts.ts` only for a repeated, legitimate need. (lint:
  `nyte-restyle/no-restyle`)
- Use logical properties, except the symmetric `left: "50%"` centre. (lint:
  `nyte-design/logical-properties`)

## Colour stairs

Pick a step by its job, never a colour by eye. Steps run strongest first, and each floor holds on
every surface and its hover fill, in light, dark and every hue scope.

- Content (text and icons): `contentPrimary` body and values, ≥7:1. `contentSecondary` labels, nav
  and tool rows, ≥6:1. `contentTertiary` metadata, hints and placeholders, ≥4.5:1.
  `contentQuaternary` chevrons, separators and idle glyphs, never text, ≥3:1. `contentDisabled`
  disabled controls only.
- Fill, translucent over any surface: `fillPrimary` pressed or strong active. `fillSecondary`
  selected, open or pressed ghost. `fillTertiary` hover, or a chip at rest.
- Stroke: `strokePrimary` (opaque) a control's boundary, such as a framed input's edge, ≥3:1.
  Translucent `strokeSecondary` strong or hover border, `strokeTertiary` default border,
  `strokeQuaternary` hairline divider.

`contentAccent` and `strokeAccent` carry the scope's hue. Surfaces, materials, scrims and the
control and button fills sit outside the stairs.

- State moves up: hover one step, pressed or open two (no fill → `fillTertiary` → `fillSecondary`).
- Text never fades; if no lower step fits, it is decoration. (lint:
  `nyte-design/no-faded-ink`)
- Disabled ink means disabled. A failed or idle item that still informs uses `contentTertiary`, an
  error `contentAccent`, an idle mark `contentQuaternary`. (lint: `nyte-design/disabled-ink`)
- An icon takes its label's step. Only decoration drops to `contentQuaternary`.
- Increased contrast moves the stairs up and never merges two steps. Syntax colours keep 4.5:1 on
  the code surfaces. (test: `pnpm --dir packages/app exec vitest --run test/tokens.test.ts`, every
  floor and step order in both `prefers-contrast` modes)

## Adding or changing a token

1. Put the value in the right `defineVars` group with a handle in `vars` or `schema`.
   `createTheme` applies its group's defaults class, so a theme re-declares every var in the group
   and hides any value set on an ancestor. Give a theme a group of only the vars it changes
   (`sidebarMotion`, `settingsDensity`). Keep vars the app writes on `<html>` at runtime, such as
   the chat width, out of themed groups. `roles` is the exception; a hue scope re-resolves every
   role on purpose.
2. Run `pnpm --dir packages/ui lock:tokens` and review the lock diff.
3. Run `pnpm --dir packages/ui sync:tokens`. It regenerates the design-scale lint's space and box
   tables, and `platform-colors.ts` and `platform-ramps.ts` (every role and ramp step as hex) for
   mobile and the docs' Colors page, which needs no edit. After renaming or deleting a role, run
   `pnpm --dir packages/mobile exec tsc --noEmit`.

## Verify

- `pnpm --dir packages/ui typecheck`: token lock, platform-colour and design-scale sync checks,
  StyleX capability check.
- `pnpm --dir packages/app exec vitest --run test/style-cascade.electron.test.ts`: layer order,
  dark-mode pairs and appearance reach, in Chromium.
- `pnpm lint`: `nyte-design` and `nyte-restyle`. Docs also runs `@shadcn/lint` on its Tailwind
  classes.
- Look at anything a user sees in light and dark with `verify-nyte`.
