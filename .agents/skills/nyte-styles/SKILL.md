---
name: nyte-styles
description: >
  How Nyte styles UI: the StyleX token system in packages/ui/src/styles, the cascade layers, built-in
  dark mode, appearance inputs, type and spacing scales, and the authoring invariants components
  follow. Use before writing or reviewing any StyleX `create()` in packages/ui, app, canvas, lab, or
  desktop renderer; when adding or changing a token, role, theme, or base.css rule; or when a style
  "doesn't apply", looks different in dark mode, or ignores an appearance setting. Not for the public
  site's visual direction (use site-design).
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
| `schema.stylex.ts` | Geometry handles: `space`, `glyph`, `target`, `button`, `input`, `row`, `menu`, `dialog`, `radius`, `layer` | components |
| `text.stylex.ts` | Whole text styles: `text.xs`, `sm`, `base`, `baseCompact`, `lg`, `code` | compose first: `props(text.sm, styles.label)` |
| `a11y.stylex.ts`, `floating-surface.stylex.ts` | Focus rings, `srOnly`, the raised-surface frame | components |
| `base.css` | The browser baseline in `@layer base` | hosts import it once |
| `tailwind.css` | The Tailwind bridge for docs and the demo site | Tailwind hosts |

Native code can't read CSS variables. `packages/ui/src/platform-colors.ts` is generated from the
roles (`pnpm --dir packages/ui sync:tokens`) and gives mobile and the docs mobile host every role as
hex per scheme and hue: `platformColors.light.contentInteractiveTertiary`,
`platformScopes.dark.red.contentSecondary`. Renaming or deleting a role breaks those readers, so run
`pnpm --dir packages/mobile exec tsgo --noEmit` after a role change.

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
   `roles.stylex.ts` plus a handle in `vars.stylex.ts`.
2. **Appearance inputs reach every surface.** The desktop writes `--nyte-font-size-base`,
   `--nyte-font-size-code`, `--nyte-font-family-*`, `--nyte-font-smoothing`, `--nyte-custom-hue`,
   and toggles transparency, cursor, and focus-modality classes on `<html>`; the canvas receives the
   same names. Derive from these; never hard-code what they control. Materials blend with
   `--nyte-reduce-transparency`; nothing paints a page background, because the window's vibrancy
   shows through.
3. **Text uses a whole style.** Pair size, line height, and tracking through `text.*`, or the
   `type.font*` and `type.leading*` handles together. Line heights round up to whole pixels at every
   UI size. 13px text needs at least the 16px line box. `lineHeight: 1` or `0` is for glyph boxes
   only. Weights come from `type.weight*`.
4. **Spacing reads the scale.** Padding, margin, gap, and inset use `space.*` (Tailwind steps on a
   4px unit, `space.px` for a hairline). A structural measurement gets a name in a schema file.
   Controls and rows take their height from `button`, `input`, `row`, `menu`, or `target`.
5. **CSS owns what CSS can resolve.** Hover, focus-within, sibling state, container size, entry
   animation, and fallbacks are StyleX features; check the capability block in
   `packages/ui/AGENTS.md` before reaching for React state, effects, observers, or
   `requestAnimationFrame`.
6. **Relational state stays scoped.** Parent-driven styling uses `stylex.when.*` with a marker the
   component defines, so an outer container's hover or focus cannot light up an inner control.
7. **Hover is an enhancement.** Guard it with `@media (hover: hover) and (pointer: fine)`; every
   action stays reachable by keyboard and touch. Focus rings read `appearance.focusRing`, which a
   host clears while focus arrives by pointer.
8. **A control can look compact and still be easy to hit.** Visual size and `target.min` are
   separate; under a coarse pointer the tokens grow, so never branch on touch by hand.
9. **Every wrapper has a job:** semantics, behavior or a ref, a formatting context, or spacing
   outside the child's border. A wrapper that only moves styles onto one child goes.
10. **A caller places a component; the component owns its look.** `xstyle` on a `@nyte-ai/ui`
    component accepts only what its contract in `packages/ui/src/styles/contracts.ts` allows, usually
    margins, self-alignment, and width. Choose its look with its props (`size`, `variant`, `tone`).
    Style a wrapper you own for anything else, or add an option to the component when the design
    calls for one. Widen a contract only for a repeated, legitimate need.
11. **Logical properties.** `paddingInline`, `insetInlineEnd`, `marginBlockStart`.

## Adding or changing a token

1. Put the value in the right `defineVars` group; expose a handle in `vars` or `schema`.
2. `pnpm --dir packages/ui lock:tokens`, then review the lock diff.
3. Colour changes: `pnpm --dir packages/ui sync:tokens` regenerates `platform-colors.ts`.

## Verify

- `pnpm --dir packages/ui typecheck` runs the token lock, the platform-colour sync check, and the
  StyleX capability check.
- `pnpm --dir packages/app exec vitest --run test/style-cascade.electron.test.ts` proves layer order,
  dark-mode pairs, and appearance reachability in Chromium.
- `pnpm lint` runs the `nyte-design` rules: spacing scale, size grid, raw colours, raw weights,
  `light-dark()` outside tokens, control sizes, touch sizes; `nyte-restyle/no-restyle` explains a
  rejected `xstyle` property. Docs runs `@shadcn/lint` for its Tailwind classes.
- For anything a user sees, load `verify-nyte` and look at it in light and dark.
