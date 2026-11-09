Load the nyte-styles skill before writing StyleX, tokens, or the base stylesheet.

Font roles and faces, and which loading indicator to show (`Spinner` or `Loader`), follow the Fonts
and Loading indicators sections of the `@nyte-ai/app` AGENTS.md.

# Dependencies

Each ui module sits on one engine. Find it before changing the module.

| Engine                      | Modules                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pierre `@pierre/diffs`      | Editor (`Editor`, `EditProvider`), code view (`CodeView`), diff (`FileDiff`, `parsePatchFiles`), worker pool (`PierreWorkerProvider`) |
| Pierre `@pierre/trees`      | File tree (`FileTree`, `useFileTree`), file-type icons (`FileTypeIcon`)                                                               |
| Pierre `@pierre/highlights` | Syntax tokens (`codeToTokens`), themes (`codeThemes`)                                                                                 |
| Base UI                     | The controls: buttons, menus, dialogs, popovers, selects, tabs, tooltips and the rest                                                 |
| StyleX                      | Every style, through the tokens and roles the nyte-styles skill describes                                                             |

## Pierre

- Pierre is a dependency of `@nyte-ai/ui` only. Every other package imports it through the flat ui
  subpath named like Pierre's: `@pierre/diffs/react` is `@nyte-ai/ui/diffs/react`, `@pierre/trees`
  is `@nyte-ai/ui/trees`. `no-restricted-imports` rejects `@pierre/*` outside ui.
- The subpaths re-export Pierre's names unchanged, values and types alike. To use another Pierre
  name, add it to the matching ui subpath first, under the same name.
- `@nyte-ai/ui/worker-pool` owns the shared worker pool (`PierreWorkerProvider`) and the options
  and CSS every surface passes Pierre (`PIERRE_HIGHLIGHTER_OPTIONS`, `PIERRE_TREE_CSS`,
  `PIERRE_TOKEN_CSS`). `@nyte-ai/ui/code-themes` owns `codeThemes`, Pierre's palettes raised to
  the text contrast floor.
- Keep one ui subpath per Pierre subpath, with no barrel. The app's `deferredEntries` fail the build
  when `@pierre/diffs` or `@pierre/highlights` reaches a startup chunk.
- Pierre is patched through the workspace's `patchedDependencies`, which key each patch on an exact
  version. Pin a patched Pierre package to an exact version when you upgrade it, then redo its patch
  with `pnpm patch` and check that every change in it still applies and is still needed.

## Pierre in tests

- Pierre renders into open shadow roots: `diffs-container` for the editor, code view and diff,
  `file-tree-container` for the file tree.
- The editor is Pierre's `Editor`, not CodeMirror or Monaco. Its textbox's accessible name is the
  file name as the workspace shows it, such as `README.md`.
- Tree rows are `treeitem`, named by the file name. Highlighted code is the `code` role.
- Query by role and accessible name, never by Pierre's class names. In Playwright specs,
  `getByRole` reaches into the open shadow roots, so `getByRole("textbox", { name })`,
  `getByRole("treeitem", { name })` and `getByRole("code")` need no helper.
- There is no shared Pierre helper. A browser test that runs through `testRenderer` uses DOM
  queries, which stop at a shadow root: read the host element's `shadowRoot`, then query by `role`
  or by Pierre's `data-*` attributes.

# Typography

Use the shared typography metrics instead of copying solid line heights from design exports: the `text` presets (`@nyte-ai/ui/styles/text.stylex`), or the `type.leading*` handles. At the default 13px UI size --nyte-line-height-xs is 14px, --nyte-line-height-sm (compact) is 16px, --nyte-line-height-base is 18px, and --nyte-line-height-lg is 24px.

Inter text at 13px must use at least the compact 16px line height (`text.baseCompact`). A 13px solid line box can clip g, j, p, q, and y when the text or an ancestor truncates or hides overflow.

Reserve line-height: 1 and leading-none for non-text glyphs, icons, or deliberately reviewed display marks. Do not compensate text with transforms, negative margins, or clip-padding hacks.

<!-- STYLEX-CAPS:START -->

StyleX v0.19.1. Use CSS-native solutions. Don't build JS workarounds for supported features.

| Group | Works | Doesn't work |
| --- | --- | --- |
| `AT-RULES` | `@media`, `(hover: hover)`, `(prefers-reduced-motion)`, `(prefers-color-scheme)`, `(scripting)`, `@supports`, `@container`, `@container (+named)`, `@starting-style`, `@starting-style (transform)`, `@scope` | `@layer`, `@property (explicit)`: compiles but invalid CSS output |
| `PSEUDO-CLS` | `:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:disabled`, `:first-child`, `:last-child`, `:nth-child()`, `:where()`, `:is()`, `:has()`, `:not()`, `:placeholder-shown`, `:checked`, `:empty`, `:modal`, `:user-valid`, `:user-invalid` | None |
| `PSEUDO-EL` | `::before`, `::after`, `::placeholder`, `::selection`, `::backdrop`, `::marker`, `::file-selector-button`, `::view-transition-old/new` | None |
| `COMPOUND` | `::backdrop+condition`, `RTL :is([dir="rtl"] *)`, `nested @media+pseudo` | None |
| `VALUES` | `var()`, `calc()`, `clamp()`, `round()`, `round(up, …)`, `light-dark()`, `color-mix()`, `container-type`, `container-name`, `color-scheme`, `accent-color`, `textWrap:balance`, `textWrap:pretty`, `fieldSizing:content`, `interpolateSize:allow-keywords` | None |
| `ANIM` | `transition shorthand`, `transition longhands`, `transitionBehavior:allow-discrete`, `animation longhands`, `stylex.keyframes`, `stylex.viewTransitionClass()` | `animation shorthand`: rejected: animation is not supported |
| `WHEN (stylex.when.*)` | `ancestor(':hover')`, `ancestor(':focus-within')`, `ancestor(':active')`, `ancestor(':disabled')`, `ancestor('[data-attr]')`, `ancestor(…)+@media`, `descendant(':hover')`, `siblingBefore(':checked')`, `siblingAfter(':checked')`, `anySibling(':hover')`, `defineMarker() scoped ancestor` | None |
| `NESTING` | None | `CSS nesting with &`: rejected: Invalid pseudo or at-rule |
| `API` | `stylex.firstThatWorks()`, `stylex.positionTry()`, `stylex.types.color()`, `stylex.types.length()`, `stylex.defineConsts()` | None |
| `DYNAMIC` | `functions in stylex.create` | None |
| `VARS` | `stylex.defineVars`, `stylex.createTheme (require .stylex.ts files)` | None |
| `ANCHOR` | `anchorName`, `positionAnchor`, `anchor()` | None |
| `LAYOUT` | `grid`, `flex+gap`, `aspect-ratio`, `overscrollBehavior`, `scrollbarGutter`, `scrollbarWidth`, `scrollbarColor`, `logical props` | None |

- Hover on touch: guard it with `@media (hover: hover)`.
- Dialog or popover entry: `@starting-style` with `transitionBehavior: allow-discrete`, not `useState` plus `requestAnimationFrame`.
- Parent state that styles a child: `stylex.when.ancestor(':hover', marker)` with a `stylex.defineMarker()` from a `.stylex.ts` file, not CSS nesting. The ancestor must pass `marker` to its `stylex.props()` call. Prefer a component-scoped `defineMarker()` over `defaultMarker()`, which leaks state from outer containers.
- Responsive to a container: `@container`, not `ResizeObserver`.
- Zebra striping: `:nth-child(even)`, not `index % 2` in JS.
- CSS fallback values: `stylex.firstThatWorks()`, not a manual fallback.
- Runtime values: `stylex.create({ s: (value) => ({ prop: value }) })`, not inline styles.
- Conditional styles: `stylex.props(condition && styles.x)`, not class name toggling.

Verify with `pnpm --dir packages/ui check:stylex`.

<!-- STYLEX-CAPS:END -->
