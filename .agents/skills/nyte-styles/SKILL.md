---
name: nyte-styles
description: >
  Explains how Nyte styles UI: the StyleX token system in packages/ui/src/styles, the cascade
  layers, built-in dark mode, appearance inputs, type and spacing scales, and the invariants
  components follow. Load it before writing or reviewing any StyleX `create()` in packages/ui, app,
  canvas, lab, or desktop renderer; when adding or changing a token, role, theme, or base.css rule;
  or when a style "doesn't apply", looks different in dark mode, or ignores an appearance setting.
  Not for the public site's visual direction.
paths:
  - "packages/*/src/**/*.{ts,tsx}"
contains: "@stylexjs/stylex"
---

# Nyte styles

Read every visual value from a token, and add a token only for a new, reusable decision. Follow
these rules when you write a style, and cite them by number when you review one.

## Where to read from

Rule numbers are stable ids that other skills and reviews cite. A removed rule leaves a gap.

1. **Import handles from `@nyte-ai/ui/styles/*`.** `vars.stylex` exports `role`, `type`,
   `motion`, `shadow` and `appearance`, and `schema.stylex` exports geometry.
2. **Compose a text style first.** `text.stylex` holds whole text styles, and one goes first in
   the call: `props(text.sm, styles.label)`.
3. **Pass a hairline beside the box's own style.** `hairline.stylex` holds 1px edges, and one goes
   next to the box's style: `props(styles.bar, hairline.blockEnd)`.
4. **Find values in the theme files.** Values live in `theme.stylex.ts`, `roles.stylex.ts` and
   `tokens.stylex.ts` in `packages/ui/src/styles/`, and `surfaceTheme`
   (`@nyte-ai/ui/surface-theme`) makes a hue scope. App-only measurements, such as the sidebar
   width, live in `packages/app/src/theme/tokens.stylex.ts` and `schema.stylex.ts`.

## The cascade

5. **Know the layer order.** From lowest to highest, the layers are the user agent, `@layer base`
   (base.css and host resets), ui component StyleX, and app StyleX, so an app's `xstyle` beats the
   component's own style. A host declares `@layer base, priority1, … priority6;` before any sheet
   loads.
6. **Use `!important` for two cases only.** `!important` in `base` beats every other layer, so use
   it only for `[hidden]` and the iOS 16px input floor.
42. **Give a conditional ui custom property no default.** An unconditional custom-property value
    compiles outside the cascade layers, while a conditional one from ui lands inside one, so write
    `{ default: null, ":not(<state>)": value }` and let the registered initial value cover the
    rest, as Button's `--nyte-hairline-elevation` does.

## Invariants

A rule here that names no lint or test is not enforced.

7. **Colours are roles.** Each colour is a role, a `light-dark()` pair that the `color-scheme` set
   by `applyDisplayMode` resolves, and a new colour is a role in `roles.stylex.ts` plus a handle in
   `vars.stylex.ts`. The lints `nyte-design/no-raw-colors` and `no-light-dark-outside-tokens`
   enforce this.
8. **Derive from the appearance inputs.** The desktop and the canvas set `--nyte-font-size-base`,
   `--nyte-font-size-code`, `--nyte-font-family-*`, `--nyte-font-smoothing`, `--nyte-custom-hue`,
   and the transparency, cursor and focus-modality classes on `<html>`, so never hard-code what
   they control. Materials blend with `--nyte-reduce-transparency`. The `style-cascade` test in
   rule 39 enforces this rule and rule 9.
9. **Paint no page background.** The window's vibrancy shows through.
10. **Set text with the type tokens.** Text takes `text.*`, or `type.font*` with `type.leading*`;
    13px text needs at least the 16px line box (`text.baseCompact`), and `lineHeight: 1` or `0` is
    for glyph boxes only. The lint `nyte-design/no-raw-font-weight` covers weights only.
11. **Take row height from `row`.** Rows and menu items take their height from `row`, which keeps
    the touch target. Visual size and `target.min` are separate tokens that grow under a coarse
    pointer, so never branch on touch by hand. The lints `nyte-design/spacing-scale`, `size-grid`,
    `control-size` and `touch-in-tokens` enforce this, and so does this test:

    ```sh
    pnpm --dir packages/app exec vitest --run control-targets
    ```

12. **Draw a separator with a hairline.** Draw a 1px separator or frame with a `hairline` style,
    which takes no layout space, never with a 1px border or compensating padding. `tableCell` goes
    on table cells, `controlRing` on a control's boundary, and `ringAfter` for a ring above a
    popup's content. Add a missing edge as a `hairline` variant.
13. **Give a box one hairline style.** A box with a hairline style takes no `boxShadow`, no
    `borderImage` beside an edge style, and no `outline*` beside `ring` (their forced-colors
    edges), so a box that draws its own focus outline takes no `ring`. StyleX merges per property
    and ui's layer sits below the app's, so a second hairline or a caller's value silently replaces
    the first.
14. **Put a raised box's shadow in `--nyte-hairline-elevation`.** That variable is registered in
    base.css and not inherited, and the shadow-drawn styles paint it before their edge.
15. **Leave `::after` free for the ring styles.** `ringAfter`, `controlRing`, `startsAfter`,
    `endsAfter` and `pressedRing` draw on `::after`, so the box must be positioned and leave
    `::after` free.
16. **Let CSS own what CSS can resolve.** Read the StyleX capability block in
    `packages/ui/AGENTS.md` before reaching for React state, effects, observers or
    `requestAnimationFrame`. The lint `nyte-code/no-direct-effect` enforces part of this.
17. **Style from a parent through an exported marker.** Use `stylex.when.*` with a marker the
    component exports from a `.stylex.ts` file, as `controlRoot` is, so an outer container's hover
    or focus can't light up an inner control.
18. **Hover only enhances.** Every action stays reachable by keyboard and touch, and the lint
    `nyte-design/guarded-hover` enforces this. Focus rings read `appearance.focusRing`, which a
    host clears while focus arrives by pointer.
19. **Give every wrapper a job.** A wrapper needs semantics, behavior or a ref, a formatting
    context, or spacing outside the child's border. Delete a wrapper that only moves styles onto
    its child.
20. **A caller places a component, and the component owns its look.** Use its props (`size`,
    `variant`, `tone`), style a wrapper you own, or add an option to the component. Widen a
    contract in `packages/ui/src/styles/contracts.ts` only for a repeated, legitimate need. The
    lint `nyte-restyle/no-restyle` enforces this.
21. **Use logical properties.** The one exception is the symmetric `left: "50%"` centre. The lint
    `nyte-design/logical-properties` enforces this.
43. **Follow Cursor's spatial scale.** Spacing, box sizes, radii and type pairs follow Cursor's
    scale, and colours stay Nyte's.
44. **Fix a grid miss at its source.** Fix it at a token or a shared component, never at one
    element.
45. **Read a `defineConsts` number as a string.** Numeric `defineConsts` entries become strings in
    production exports, so wrap them in `Number()` before JavaScript arithmetic and add them with
    CSS `calc()`.
46. **Preview a dynamic style through `props()`.** StyleX rewrites a dynamic custom property's key,
    so an imperative preview applies `props(panelWidth(pixels)).style`, never a write to
    `--_workbench-width`.

## Colour stairs

22. **Pick a step by its job, never a colour by eye.** Steps run strongest first, and each contrast
    floor holds on every surface and its hover fill, in light, dark and every hue scope.
23. **Content steps colour text and icons.** `contentPrimary` is for body text and values (at least
    7:1), `contentSecondary` for labels, nav and tool rows (at least 6:1), and `contentTertiary`
    for metadata, hints and placeholders (at least 4.5:1). `contentQuaternary` is for chevrons,
    separators and idle glyphs, never text (at least 3:1), and `contentDisabled` is for disabled
    controls only.
24. **Fill steps are translucent over any surface.** `fillPrimary` is for pressed or strong active,
    `fillSecondary` for selected, open or a pressed ghost control, and `fillTertiary` for hover or a
    chip at rest.
25. **Stroke steps draw borders.** The opaque `strokePrimary` is a control's boundary, such as a
    framed input's edge (at least 3:1). The translucent ones are `strokeSecondary` for a strong or
    hover border, `strokeTertiary` for the default border, and `strokeQuaternary` for a hairline
    divider.
26. **Accents carry the hue, and some colours sit outside the stairs.** `contentAccent` and
    `strokeAccent` carry the scope's hue. Surfaces, materials, scrims and the control and button
    fills are not stairs.
27. **State moves up the stairs.** Hover moves one step, and pressed or open moves two: from no
    fill to `fillTertiary` to `fillSecondary`.
28. **Text never fades.** Never fade text with opacity; if no lower step fits, the element is
    decoration. The lint `nyte-design/no-faded-ink` enforces this.
29. **Disabled ink means disabled.** A failed or idle item that still informs uses
    `contentTertiary`, an error uses `contentAccent`, and an idle mark uses `contentQuaternary`.
    The lint `nyte-design/disabled-ink` enforces this.
30. **An icon takes its label's step.** Only decoration drops to `contentQuaternary`.
31. **Increased contrast moves the stairs up and never merges two steps.** Syntax colours keep 4.5:1
    on the code surfaces. This test checks every floor and the step order in both
    `prefers-contrast` modes:

    ```sh
    pnpm --dir packages/app exec vitest --run test/tokens.test.ts
    ```

47. **Show an error with `intent.danger`.** Its secondary ink is `contentAccent`.
    `surfaceTheme.red` is decorative and keeps the tinted secondary ink.
48. **Check which role an element selects.** A danger scope doesn't recolour a `color` the element
    already inherits, so read the role it selects before calling its text red.
49. **Measure contrast on the composited fill.** Stack the selected fill with the hover or active
    layers, as a ghost Button does, and measure ink on the result, never on one fill alone.

## Adding or changing a token

Take these steps in order.

32. **Put the value in the right group.** Put the value in the right `defineVars` group, with a
    handle in `vars` or `schema`.
33. **Give a theme only the vars it changes.** `createTheme` applies its group's defaults class, so
    a theme re-declares every var in the group and hides any value set on an ancestor. Give a theme
    a group of only the vars it changes (`sidebarMotion`, `settingsDensity`); `roles` is the
    exception, because a hue scope re-resolves every role on purpose.
34. **Keep runtime vars out of themed groups.** Vars the app writes on `<html>` at runtime, such as
    the chat width, go in no themed group.
35. **Lock the tokens.** Run this, then review the lock diff:

    ```sh
    pnpm --dir packages/ui lock:tokens
    ```

36. **Sync the tokens.** This regenerates the design-scale lint's space and box tables, and
    `platform-colors.ts` and `platform-ramps.ts` (every role and ramp step as hex) for mobile and
    the docs' Colors page, which needs no edit:

    ```sh
    pnpm --dir packages/ui sync:tokens
    ```

37. **Typecheck mobile after renaming or deleting a role.**

    ```sh
    pnpm --dir packages/mobile exec tsc --noEmit
    ```

## Verify

38. **Typecheck ui.** This runs the token lock check, the platform-colour and design-scale sync
    checks, and the StyleX capability check:

    ```sh
    pnpm --dir packages/ui typecheck
    ```

39. **Run the cascade test.** This checks the layer order, the dark-mode pairs and how far the
    appearance inputs reach, in Chromium:

    ```sh
    pnpm --dir packages/app exec vitest --run test/style-cascade.electron.test.ts
    ```

40. **Run the lint.** `pnpm lint` runs `nyte-design` and `nyte-restyle`, and docs also runs
    `@shadcn/lint` on its Tailwind classes.
41. **Look in light and dark.** Look at anything a user sees in light and dark with the verify-nyte
    skill.
