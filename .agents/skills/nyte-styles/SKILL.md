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

Every visual value is a decision someone already made. Read it from a token; add a token only when
the decision is new and reusable.

## Where things live

All of it is in `packages/ui/src/styles/`, exported as `@nyte-ai/ui/styles/*`.

| File | Holds | Read it through |
| --- | --- | --- |
| `theme.stylex.ts` | Hue ramps (data) and the `theme` layer; one hue at a time per scope | never directly |
| `roles.stylex.ts` | Colour roles as `light-dark()` pairs over the theme; `tinted` re-declares them per scope | `role.*` in `vars.stylex.ts` |
| `tokens.stylex.ts` | Appearance inputs, shadows, type, spacing unit, motion, component measurements | `type`, `motion`, `shadow`, `appearance` in `vars.stylex.ts`; geometry in `schema.stylex.ts` |
| `vars.stylex.ts` | Typed handles: `role`, `type`, `motion`, `shadow`, `appearance` | components |
| `schema.stylex.ts` | Geometry handles: `space`, `glyph`, `target`, `control`, `button`, `input`, `row`, `menu`, `dialog`, `radius`, `layer` | components |
| `text.stylex.ts` | Whole text styles: `text.xs`, `sm`, `base`, `baseCompact`, `lg`, `xl`, `2xl`, `3xl`, `code` | compose first: `props(text.sm, styles.label)` |
| `a11y.stylex.ts`, `floating-surface.stylex.ts` | Focus rings, `srOnly`, the raised-surface frame | components |
| `base.css` | The browser baseline in `@layer base` | hosts import it once |
| `tailwind.css` | The Tailwind bridge for docs and the demo site | Tailwind hosts |

Native code can't read CSS variables. `packages/ui/src/platform-colors.ts` is generated from the
roles (`pnpm --dir packages/ui sync:tokens`) and gives mobile and the docs mobile host every role as
hex per scheme and hue: `platformColors.light.contentQuaternary`,
`platformScopes.dark.red.contentSecondary`, and `platform-ramps.ts` gives every ramp step: `platformRamps.blue.opaque["80"]`.
The design docs' Colors page renders all three, so a new role or step appears there without an
edit. Renaming or deleting a role breaks those readers, so run
`pnpm --dir packages/mobile exec tsc --noEmit` after a role change.

App-only structural measurements (sidebar width, titlebar height, prose measure) live in
`packages/app/src/theme/tokens.stylex.ts` and `schema.stylex.ts`.

## The cascade

From lowest to highest: user agent, `@layer base` (base.css and host resets), ui component StyleX,
app StyleX. A host declares `@layer base, priority1, … priority6;` before any sheet loads. Component
rules always beat base.css; an app style passed through `xstyle` always beats the component's own.
`!important` in `base` beats everything above it, so it is reserved for `[hidden]` and the iOS
16px input floor.

## Invariants

1. **Dark mode is built in.** Every colour role is a `light-dark()` pair, resolved by
   `color-scheme` that `applyDisplayMode` sets. Components read a role; they never write
   `light-dark()`, a hex, `rgb()`, or `oklch()` themselves. A new colour need is a new role in
   `roles.stylex.ts` plus a handle in `vars.stylex.ts`. (lint: `nyte-design/no-raw-colors`,
   `nyte-design/no-light-dark-outside-tokens`; test: `pnpm --dir packages/app exec vitest --run style-cascade`)
2. **Appearance inputs reach every surface.** The desktop writes `--nyte-font-size-base`,
   `--nyte-font-size-code`, `--nyte-font-family-*`, `--nyte-font-smoothing`, `--nyte-custom-hue`,
   and toggles transparency, cursor, and focus-modality classes on `<html>`; the canvas receives the
   same names. Derive from these; never hard-code what they control. Materials blend with
   `--nyte-reduce-transparency`; nothing paints a page background, because the window's vibrancy
   shows through. (test: `pnpm --dir packages/app exec vitest --run style-cascade`)
3. **Text uses a whole style.** Pair size, line height, and tracking through `text.*`, or the
   `type.font*` and `type.leading*` handles together. Line heights round up to whole pixels at every
   UI size. 13px text needs at least the 16px line box. `lineHeight: 1` or `0` is for glyph boxes
   only. Weights come from `type.weight*`. (lint: `nyte-design/no-raw-font-weight`; test:
   `pnpm --dir packages/app exec vitest --run style-cascade`; the size and line-height pairing is not enforced)
4. **Spacing reads the scale.** Padding, margin, gap, and inset use `space.*` (Tailwind steps on a
   4px unit, `space.px` for a 1px length). A structural measurement gets a name in a schema file.
   Controls take their height from the `control` scale; rows and menu items from `row`, which
   keeps the touch target. An `Icon` takes a glyph step for `size`. (lint:
   `nyte-design/spacing-scale`, `nyte-design/size-grid`, `nyte-design/control-size`)
   A hairline never takes layout space, so a box keeps its grid size: draw a 1px separator or frame
   with `hairline` (`@nyte-ai/ui/styles/hairline.stylex`): `blockEnd`, `tableRow` on table cells, or
   `ring`. Each is an inset box-shadow in `strokeQuaternary` with its forced-colors border inside. No
   1px block-start or block-end border as a separator, and no padding that makes up for one. Inline
   dividers, such as a table's column divider, are still borders. A box that takes a hairline sets no
   `border`, `borderWidth`, `borderStyle` or `borderColor` of its own: ui's styles sit in an earlier
   layer, so the app's shorthand would replace the forced-colors border. It sets no `boxShadow`
   either: StyleX merges per property, so its shadow would replace the hairline's. Add a variant to
   `hairline` instead. (not enforced)
5. **CSS owns what CSS can resolve.** Hover, focus-within, sibling state, container size, entry
   animation, and fallbacks are StyleX features; check the capability block in
   `packages/ui/AGENTS.md` before reaching for React state, effects, observers, or
   `requestAnimationFrame`. (partly, lint: `nyte-code/no-direct-effect`)
6. **Relational state stays scoped.** Parent-driven styling uses `stylex.when.*` with a marker the
   component defines, so an outer container's hover or focus cannot light up an inner control.
   (not enforced)
7. **Hover is an enhancement.** Guard it with `@media (hover: hover) and (pointer: fine)`
   (`[media.hover]`); every action stays reachable by keyboard and touch. A style that names a
   disabled state excludes it from its hover, as Button does: `":hover:not([data-disabled])"`.
   Focus rings read `appearance.focusRing`, which a host clears while focus arrives by pointer.
   (lint: `nyte-design/guarded-hover`; test: `pnpm --dir packages/app exec vitest --run style-cascade`)
8. **A control can look compact and still be easy to hit.** Visual size and `target.min` are
   separate; under a coarse pointer the tokens grow, so never branch on touch by hand. (lint:
   `nyte-design/touch-in-tokens`, `nyte-design/control-size`; test:
   `pnpm --dir packages/app exec vitest --run control-targets`)
9. **Every wrapper has a job:** semantics, behavior or a ref, a formatting context, or spacing
   outside the child's border. A wrapper that only moves styles onto one child goes. (not
   enforced)
10. **A caller places a component; the component owns its look.** `xstyle` on a `@nyte-ai/ui`
    component accepts only what its contract in `packages/ui/src/styles/contracts.ts` allows, usually
    margins, self-alignment, and width. Choose its look with its props (`size`, `variant`, `tone`).
    Style a wrapper you own for anything else, or add an option to the component when the design
    calls for one. Widen a contract only for a repeated, legitimate need. (lint:
    `nyte-restyle/no-restyle`)
11. **Logical properties.** `paddingInline`, `insetInlineEnd`, `marginBlockStart`. Centring is
    the exception: `left: "50%"` with a -50% translate is symmetric, while a logical anchor flips
    without its translate. (lint: `nyte-design/logical-properties`)

## Colour stairs

Text, icons, fills and strokes each come in a ladder of steps called stairs, strongest first. Each
step has one job and a contrast floor. The floor holds on every surface (`bgBase`, `bgMuted`,
`bgElevated`, `bgChrome`), on the hover fill over each of them, in light and dark and in every hue
scope. Pick the step for the job; never tune a colour by eye.

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
2. **Text never fades.** De-emphasise with a lower step, never with `opacity` or `color-mix()`; if
   no step fits, the content is decoration. Opacity stays for whole-element fades and images.
   (lint: `nyte-design/no-faded-ink`)
3. **Disabled ink means disabled.** A failed or idle item that still informs uses
   `contentTertiary`, an error `contentAccent`, an idle mark `contentQuaternary`. (lint:
   `nyte-design/disabled-ink`)
4. **An icon shares its label's step.** Only decoration drops to `contentQuaternary`. (not enforced)
5. **Increased contrast moves the stairs up**; it never merges two steps. (test:
   `pnpm --dir packages/app exec vitest --run test/tokens.test.ts`, which runs both
   `prefers-contrast` modes and checks every floor, including `strokePrimary` over the hover fill,
   and that each content, fill and stroke step stays above the next)

Highlighted code follows the same floors: syntax colours keep 4.5:1 on the code surfaces.

## Adding or changing a token

1. Put the value in the right `defineVars` group; expose a handle in `vars` or `schema`.
2. `pnpm --dir packages/ui lock:tokens`, then review the lock diff.
3. `pnpm --dir packages/ui sync:tokens` regenerates `platform-colors.ts` from the colour roles and
   the design-scale lint's space and box tables from the `space` and box-sizing handles.

## Verify

- `pnpm --dir packages/ui typecheck` runs the token lock, the platform-colour sync check, and the
  StyleX capability check.
- `pnpm --dir packages/app exec vitest --run test/style-cascade.electron.test.ts` proves layer order,
  dark-mode pairs, and appearance reachability in Chromium.
- `pnpm lint` runs the `nyte-design` rules: spacing scale, size grid, raw colours, raw weights,
  `light-dark()` outside tokens, control sizes, touch sizes, guarded hover, logical properties; `nyte-restyle/no-restyle` explains a
  rejected `xstyle` property. Docs runs `@shadcn/lint` for its Tailwind classes.
- For anything a user sees, load `verify-nyte` and look at it in light and dark.
