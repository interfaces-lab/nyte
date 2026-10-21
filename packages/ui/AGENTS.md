Load `.agents/skills/nyte-styles` before writing StyleX, tokens, or `base.css`.

# Typography

Use the shared typography metrics instead of copying solid line heights from design exports: `text` in `src/styles/text.stylex.ts`, or the `type.leading*` handles. At the default 13px UI size --nyte-line-height-xs is 14px, --nyte-line-height-sm (compact) is 16px, --nyte-line-height-base is 18px, and --nyte-line-height-lg is 24px.

Inter text at 13px must use at least the compact 16px line height (`text.baseCompact`). A 13px solid line box can clip g, j, p, q, and y when the text or an ancestor truncates or hides overflow.

Reserve line-height: 1 and leading-none for non-text glyphs, icons, or deliberately reviewed display marks. Do not compensate text with transforms, negative margins, or clip-padding hacks.

TextShimmer inherits font metrics. Put typography overrides on its parent when they must supersede the component defaults.

<!-- STYLEX-CAPS:START -->

[StyleX v0.19.1 CSS Support]|Use CSS-native solutions. Don't build JS workarounds for supported features.
|AT-RULES: @media, (hover: hover), (prefers-reduced-motion), (prefers-color-scheme), (scripting), @supports, @container, @container (+named), @starting-style, @starting-style (transform), @scope — YES
|AT-RULES: @layer, @property (explicit) — NO (compiles but invalid CSS output)
|PSEUDO-CLS: :hover, :focus, :focus-visible, :focus-within, :active, :disabled, :first-child, :last-child, :nth-child(), :where(), :is(), :has(), :not(), :placeholder-shown, :checked, :empty, :modal, :user-valid, :user-invalid — YES
|PSEUDO-EL: ::before, ::after, ::placeholder, ::selection, ::backdrop, ::marker, ::file-selector-button, ::view-transition-old/new — YES
|COMPOUND: ::backdrop+condition, RTL :is([dir="rtl"] *), nested @media+pseudo — YES
|VALUES: var(), calc(), clamp(), round(), round(up, …), light-dark(), color-mix(), container-type, container-name, color-scheme, accent-color, textWrap:balance, textWrap:pretty, fieldSizing:content, interpolateSize:allow-keywords — YES
|ANIM: transition shorthand, transition longhands, transitionBehavior:allow-discrete, animation longhands, stylex.keyframes, stylex.viewTransitionClass() — YES
|ANIM: animation shorthand — NO (rejected: animation is not supported)
|WHEN (stylex.when.*): ancestor(':hover'), ancestor(':focus-within'), ancestor(':active'), ancestor(':disabled'), ancestor('[data-attr]'), ancestor(…)+@media, descendant(':hover'), siblingBefore(':checked'), siblingAfter(':checked'), anySibling(':hover'), defineMarker() scoped ancestor — YES
|NESTING: CSS nesting with & — NO (rejected: Invalid pseudo or at-rule)
|API: stylex.firstThatWorks(), stylex.positionTry(), stylex.types.color(), stylex.types.length(), stylex.defineConsts() — YES
|DYNAMIC: functions in stylex.create — YES
|VARS: stylex.defineVars, stylex.createTheme (require .stylex.ts files) — YES
|ANCHOR: anchorName, positionAnchor, anchor() — YES
|LAYOUT: grid, flex+gap, aspect-ratio, overscrollBehavior, scrollbarGutter, scrollbarWidth, scrollbarColor, logical props — YES
|PATTERN: hover on touch -> @media (hover: hover) guard
|PATTERN: dialog/popover entry -> @starting-style + transitionBehavior:allow-discrete (not useState+rAF)
|PATTERN: parent state -> child style -> stylex.when.ancestor(':hover', marker) with stylex.defineMarker() from a .stylex.ts file (not CSS nesting). The ancestor MUST include marker in its stylex.props() call. Prefer a component-scoped defineMarker() over defaultMarker(), which leaks state from outer containers
|PATTERN: container responsive -> @container (not ResizeObserver)
|PATTERN: zebra striping -> :nth-child(even) (not index%2 JS)
|PATTERN: CSS fallback values -> stylex.firstThatWorks() (not manual fallback)
|PATTERN: dynamic/runtime values -> stylex.create({ s: (value) => ({ prop: value }) }) (not inline styles)
|PATTERN: conditional styles -> stylex.props(condition && styles.x) (not className toggling)
|VERIFY: pnpm --dir packages/ui check:stylex

<!-- STYLEX-CAPS:END -->
