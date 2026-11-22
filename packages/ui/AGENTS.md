# UI

- Load the nyte-styles skill before writing StyleX, tokens or the base stylesheet.
- Font roles and faces follow the Fonts section of the `@nyte-ai/app` AGENTS.md.
- Which loading indicator to show, `Spinner` or `Loader`, follows its Loading indicators section.
- ui has no test script. An empty, zero-exit `pnpm --dir packages/ui test` is not a pass.

## Engines

Each ui module sits on one engine. Find it before changing the module.

| Engine                      | Modules                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pierre `@pierre/diffs`      | Editor (`Editor`, `EditProvider`), code view (`CodeView`), diff (`FileDiff`, `parsePatchFiles`), worker pool (`PierreWorkerProvider`) |
| Pierre `@pierre/trees`      | File tree (`FileTree`, `useFileTree`), file-type icons (`FileTypeIcon`)                                                               |
| Pierre `@pierre/highlights` | Syntax tokens (`codeToTokens`), themes (`codeThemes`)                                                                                 |
| Base UI                     | The controls: buttons, menus, dialogs, popovers, selects, tabs, tooltips and the rest                                                 |
| TanStack Table              | Table (`Table`, `TableHead`, `TableResizer` and the other parts), column sizing and resizing                                          |
| StyleX                      | Every style, through the tokens and roles the nyte-styles skill describes                                                             |

## Importing Pierre

- Pierre is a dependency of `@nyte-ai/ui` only. `no-restricted-imports` rejects `@pierre/*` outside ui.
- Every other package imports Pierre through the flat ui subpath named like Pierre's. `@pierre/diffs/react` is `@nyte-ai/ui/diffs/react`, and `@pierre/trees` is `@nyte-ai/ui/trees`.
- The subpaths re-export Pierre's names unchanged, values and types alike. To use another Pierre name, add it to the matching ui subpath first, under the same name.
- Keep one ui subpath per Pierre subpath, with no barrel.
- The app's `deferredEntries` fail the build when `@pierre/diffs` or `@pierre/highlights` reaches a startup chunk.
- `@nyte-ai/ui/worker-pool` owns the shared worker pool (`PierreWorkerProvider`). It also owns the options and CSS every surface passes Pierre: `PIERRE_HIGHLIGHTER_OPTIONS`, `PIERRE_TREE_CSS` and `PIERRE_TOKEN_CSS`.
- `@nyte-ai/ui/code-themes` owns `codeThemes`, Pierre's palettes raised to the text contrast floor.
- Pierre is patched through the workspace's `patchedDependencies`, which key each patch on an exact version.
- When you upgrade a patched Pierre package, pin it to an exact version. Then redo its patch with `pnpm patch`, and check that every change in it still applies and is still needed.

## Pierre surfaces

These hold for every surface that renders through Pierre: the Editor, Changes, chat diffs, the declaration peek, the settings previews and the file trees.

- **One worker pool,** `PierreWorkerProvider`. Never mount `WorkerPoolContextProvider` or a second pool.
- The pool highlights anything up to `mainThreadMaxCharacters` (100,000) on the main thread, as Pierre's docs ask for the highlights backend. Only larger files and diffs start a worker.
- **No pool around an edited file.** The `Editor` tokenizes on the main thread and drops pool output. If a pool must serve an editable surface, give it `useTokenTransformer: true`.
- **One `CodeView` per scroll region** that lists only files and diffs, such as Changes.
- A list that mixes other content, such as the chat transcript, keeps its own virtualizer. It renders each diff with `FileDiff`.
- **Keep `options` equal between renders.** The React `CodeView` and `FileDiff` compare them shallowly. Any unequal value re-renders the whole viewer.
- Nested option objects (`layout`, `searchOptions`, `itemMetrics`) are module constants or cached per input.
- Callbacks read the latest state through a store or ref. They never close over per-render data.
- **`onPostRender` never reads computed style or layout.** It runs for every item Pierre renders or recycles.
- Colours that depend on the appearance go on the surface's root once per appearance (`applyDiffScopes`). The shadow host inherits them.
- **`itemMetrics` matches what the CSS draws.** Take the line height from the code font size. Update the hunk separator and header heights whenever `unsafeCSS` or a custom header changes them.
- **A `cacheKey` names the content,** such as a digest or a revision. It never names only a path. An accepted edit gets a fresh one.
- Key annotation UI by a stable metadata ID, not a line number.
- **File trees create their model once** with `useFileTree`. Push path changes with `resetPaths` or `batch`, and statuses with `setGitStatus`.
- The tree reads its options once, so callbacks read the latest props through a ref.
- Chat code blocks highlight with `@pierre/highlights` directly (`codeToTokens`, `StreamTokenizer`), not through a diffs component.
- Measure a change to any of these with the desktop `pierre-surfaces` bench (`NYTE_PIERRE_SURFACES`). It runs a long chat of diffs, a 40-file Changes stack, a 6-file review and the explorer on golang.org/x/tools.

## Pierre in tests

- Pierre renders into open shadow roots: `diffs-container` for the editor, code view and diff, `file-tree-container` for the file tree.
- The editor is Pierre's `Editor`, not CodeMirror or Monaco. Its textbox's accessible name is the file name as the workspace shows it, such as `README.md`.
- Tree rows are `treeitem`, named by the file name. Highlighted code is the `code` role.
- Query by role and accessible name, never by Pierre's class names.
- In Playwright specs, `getByRole` reaches into the open shadow roots. `getByRole("textbox", { name })`, `getByRole("treeitem", { name })` and `getByRole("code")` need no helper.
- A browser test that runs through `testRenderer` uses DOM queries, which stop at a shadow root. Read the host element's `shadowRoot`, then query by `role` or by Pierre's `data-*` attributes. There is no shared Pierre helper.
- Gutter cells carry `data-column-number`. Source cells carry `data-line`.

## TanStack Table

- TanStack Table v9 is a dependency of `@nyte-ai/ui` only. `no-restricted-imports` rejects `@tanstack/react-table` outside ui.
- Other packages import its names from `@nyte-ai/ui/table`, which re-exports them unchanged beside the styled parts. Add a name there before using it.
- TanStack ships its agent skills in the package. List them from the ui package with `npx @tanstack/intent@latest list`.
- Load one with `npx @tanstack/intent@latest load @tanstack/react-table#getting-started`.
- Load `@tanstack/table-core#table-features` before adding a feature.

## Base UI

- A trigger that shrinks on `:active` must not anchor a `Select` with `alignItemWithTrigger`. Base UI reads the scale as zoom and opens the popup off the trigger. Give the trigger `scale: 1`, as `PickerTrigger` does.
- To animate a popup with Motion, keep the Root controlled and wrap `{open && <X.Portal keepMounted>}` in `AnimatePresence`.
- Pass the element form `render={<motion.div />}`. The function form needs a cast.
- Base UI ends the closing phase only for a Motion exit that animates `opacity`. For any other exit, call `eventDetails.preventUnmountOnClose()` and later `actionsRef.current.unmount()`.

## Typography

- Take line heights from the shared metrics: the `text` presets (`@nyte-ai/ui/styles/text.stylex`) or the `type.leading*` handles. Never copy a solid line height from a design export.
- At the default 13px UI size, `--nyte-line-height-xs` is 14px, `--nyte-line-height-sm` (compact) is 16px, `--nyte-line-height-base` is 18px and `--nyte-line-height-lg` is 24px.
- Inter text at 13px needs at least the compact 16px line height (`text.baseCompact`). A 13px solid line box can clip g, j, p, q and y when the text or an ancestor truncates or hides overflow.
- Reserve `line-height: 1` and leading-none for glyphs, icons and reviewed display marks.
- Don't compensate text with transforms, negative margins or clip-padding hacks.

## StyleX capabilities

`pnpm --dir packages/ui sync:stylex` writes this block, and `check:stylex` fails when it is stale. Don't edit it by hand.

<!-- STYLEX-CAPS:START -->

StyleX v0.19.2. Use CSS-native solutions. Don't build JS workarounds for supported features.

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
- Parent state that styles a child: `stylex.when.ancestor(':hover', marker)` with a `stylex.defineMarker()` exported from a StyleX module, not CSS nesting. The ancestor must pass `marker` to its `stylex.props()` call. Prefer a component-scoped `defineMarker()` over `defaultMarker()`, which leaks state from outer containers.
- Responsive to a container: `@container`, not `ResizeObserver`.
- Zebra striping: `:nth-child(even)`, not `index % 2` in JS.
- CSS fallback values: `stylex.firstThatWorks()`, not a manual fallback.
- Runtime values: `stylex.create({ s: (value) => ({ prop: value }) })`, not inline styles.
- Conditional styles: `stylex.props(condition && styles.x)`, not class name toggling.

Verify with `pnpm --dir packages/ui check:stylex`.

<!-- STYLEX-CAPS:END -->
