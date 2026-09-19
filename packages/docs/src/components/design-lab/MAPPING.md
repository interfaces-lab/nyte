# Notion's design system, and where each piece lands in Nyte

Source: `calendar.notion.so/assets/AgentChat-C-LmE14v.css` (741 KB raw, 48.5 KB brotli).
Nyte side: `packages/desktop/src/renderer/src/theme/tokens.css` and `vars.stylex.ts`.

---

## 1. The shape of the two systems

Notion runs **four tiers**. Nyte runs **two**.

| tier | Notion | Nyte |
| --- | --- | --- |
| curve | `--tpl-l-*`, `--tpl-c-*`, `--tpl-tl/tc/ta-*` — one lightness/chroma/alpha ramp reused by every hue | — none — |
| palette | `--<hue>-0..150` and `--translucent-<hue>-0..150`, ten hues | `--nyte-red`, `--nyte-green`, … — one literal per hue, no ramp |
| theme | `--theme-*` / `--content-theme-*`, the active hue bound by `[data-theme]` | — none — |
| semantic | `--bg-*`, `--content-*`, `--border-*` | `--nyte-bg-*`, `--nyte-text-*`, `--nyte-icon-*`, `--nyte-stroke-*` |

Nyte's two tiers are anchors and a derived ramp off `--nyte-base`. That is a
sound design and it is why the codebase has only four raw colour literals
outside the theme directory. The gap is not discipline; it is that the ramp
only runs in one direction (neutral ink over the page) and only exists in
alpha form.

---

## 2. Semantic layer, role by role

Notion's steps are its 0–150 ramp. Nyte's are percentages of `--nyte-base`.
Light mode both sides.

### Surfaces

| role | Notion | step | Nyte | gap |
| --- | --- | --- | --- | --- |
| window page | `--bg-base` | 0 | `--nyte-bg-editor` | — |
| chrome / titlebar | `--bg-chrome` | 5 | `--nyte-bg-chrome` | — |
| card, popover | `--bg-elevated` | 0 | `--nyte-bg-raised` | — |
| recessed well | `--bg-muted` | 10 | `--nyte-bg-card` (6%) | — |
| resting tint | `--bg-interactive-secondary` | 15 | `--nyte-bg-quinary` (4%) | — |
| hover | `--bg-interactive-secondary-hover` | — | `--nyte-bg-tertiary` (8%) | **see §4** |
| pressed | `--bg-interactive-secondary-pressed` | — | — none — | Nyte has no pressed step |
| selected | `--bg-control-selected` | 80 | `--nyte-bg-quaternary` (6%) | **see §4** |
| strong fill | `--bg-interactive-strong` | 80 | `--nyte-fill-primary` | — |
| inverse | `--bg-inverse` | 130 | `--nyte-fill-primary` | Nyte reuses one token for both |
| scrim | `--bg-scrim` | 40 | `--nyte-bg-scrim` | Nyte's is a literal `rgb(0 0 0/40%)`, not on the ramp |

### Content

| role | Notion | step | Nyte | % |
| --- | --- | --- | --- | --- |
| primary | `--content-primary` | 110 | `--nyte-text-primary` | 100 |
| secondary | `--content-secondary` | 90 | `--nyte-text-secondary` | 74 |
| tertiary | `--content-tertiary` | 60 | `--nyte-text-tertiary` | 60 |
| disabled | `--content-disabled` | 40 | `--nyte-text-quaternary` | 36 |
| on chrome | `--content-chrome` | 90 | — none — | Nyte's titlebar borrows `textSecondary` |
| icon primary | — shares content — | | `--nyte-icon-primary` | 100 |
| icon secondary | — shares content — | | `--nyte-icon-secondary` | 66 |
| icon tertiary | — shares content — | | `--nyte-icon-tertiary` | 52 |
| on strong fill | `--content-on-interactive-strong` | 0 | `--nyte-text-invert` | — |
| on colour | `--content-on-control` | — | `--nyte-action-label` | — |

Notion has no separate icon ramp; Nyte does, at 66/52 against text's 74/60.
That is a deliberate optical correction — a stroked glyph reads lighter than
type at the same value — and it is the one place Nyte is *ahead*. Keep it.

### Borders

| role | Notion | step | Nyte | % |
| --- | --- | --- | --- | --- |
| strong | `--border-strong` | 40 | `--nyte-stroke-primary` | 20 |
| default | `--border-primary` | 30 | `--nyte-stroke-secondary` | 12 |
| subtle | `--border-secondary` | 20 | `--nyte-stroke-tertiary` | 8 |
| hairline | — | | `--nyte-stroke-quaternary` | 4 |
| control | `--border-control` | — | — none — | checkbox/switch outline |
| focus | `--border-interactive-primary` | 80 | `--nyte-stroke-focused` | — |

### Geometry and type

| role | Notion | Nyte | note |
| --- | --- | --- | --- |
| radius | `--radius-{0,2,4,6,8,10,12,14,16,20,24,full}` | `--nyte-radius-{xs,sm,base,lg,xl,2xl,full}` = 2/4/6/8/12/14/9999 | Notion names by value, Nyte by rank. Nyte's is better for a design system; Notion's is better for a Tailwind build. Values overlap almost exactly. |
| spacing | `--spacing-{0,2,4,…}` | — none — | Nyte inlines numbers in StyleX. Fine: StyleX evaluates once. |
| sizing | `--sizing-{0,2,…,1280}` | named geometry in `schema.stylex.ts` | Nyte's is stronger — named decisions beat a number bag. |
| type | `--text-{body-xs,body-sm,body,title,title-lg}`, each with `--line-height` and some with `--font-weight` | `--nyte-font-size-{xs,sm,base,lg,2xl}` + separate `--nyte-line-height-*` | Notion pairs size and leading in one token. Nyte keeps them independent, and `--nyte-line-height-base` is `calc(base + 9px)` so the pairing is already implicit. |
| weight | 450 / 550 / 650 / 700 | 400 / 500 / 600 | Notion's are variable-font optical weights. Only usable if the face is variable; Inter Variable is. |
| ease | `--ease-{default,enter,exit}` | `--nyte-easing-{out,out-quint,in-out-strong}` | Notion splits by lifecycle, Nyte by curve shape. Notion's naming is better — it tells you when to use it. |
| density | four values per type token, chosen by a root attribute | `--nyte-font-size-base` set inline from settings | Same idea, Nyte's is simpler. |

---

## 3. The four structural patterns

These are the parts with no Nyte equivalent at all.

**Alpha twins.** Every solid step has an alpha step tuned so that compositing
it over the base surface reproduces the solid. `--gray-5: #fbfbfa` and
`--translucent-gray-5: #33330005`. Light mode inks are warm-black at low alpha;
dark mode inks are white. Step 0 is fully transparent.

Nyte has the alpha half only, and only for neutral. There is no solid twin, so
`Reduce Transparency` cannot flatten anything, and no hue has a wash ramp — which
is why `tokens.css` carries eight one-off literals for diff lines, technical
blocks and conversation guides, each written twice for light and dark.

**Per-hue ramps.** Ten hues × 20 steps × two forms, all generated from one
`--tpl-*` curve. A custom hue costs zero CSS:
`oklch(var(--tpl-l-80) calc(var(--tpl-c-80) * var(--custom-chroma-scale)) var(--custom-hue))`.

Nyte's tint does the equivalent job with `hsl(from … )` on four anchors. See §5.

**`@scope` theming.** Modes and tints are declared as
`@scope([data-display-mode=dark]) to ([data-display-mode])`, with light on
`:root, [data-display-mode=light]`. Scope proximity resolves before specificity,
so a nested theme beats an outer one without any specificity fight.

Nyte uses `:root[data-theme="dark"]`, which no subtree can override.

**`-outline` elevation.** Every shadow has a twin carrying the 1px hairline in
the same `box-shadow`, in an alpha colour, with an `inset` variant for clipped
surfaces.

**Nyte already does this** — `floating-surface.stylex.ts` and
`tray.stylex.ts` both fold the hairline into the shadow. Nothing to take.

---

## 4. The one defect this mapping exposes

`vars.stylex.ts` says:

> Three fills cover every interactive surface, and nothing else may name one:
> `fillGhostHover` for hover, `fillGhostSelected` for the current item, and
> `fillSecondary` for a resting tint. A fourth name is how a hovered row ends
> up lighter than a selected one.

Then:

```
fillGhostHover    → --nyte-bg-tertiary    →  8%
fillGhostSelected → --nyte-bg-quaternary  →  6%
```

Hover is **stronger** than selected. The file warns about the exact failure it
has. It is systemic:

| call site | hover | selected | |
| --- | --- | --- | --- |
| `chrome/sidebar.stylex.ts` `navRow` / `navRowActive` | 8% | 6% | inverted |
| `workbench/tab-strip.tsx` | 8% | 6% | inverted |
| `workbench/files-panel.tsx` | 8% | 6% | inverted |
| `components/menu.tsx` | `bgCard` 6% | `fillGhostHover` 8% | correct — and opposite |

So the same two tokens carry opposite meanings in the menu and in the rail.
`navRowActive` also pins its hover to `fillGhostSelected`, so hovering the
*selected* row makes it lighter than hovering any other row.

Notion's ladder makes this hard to get wrong because the states are named for
what they are — `interactive-secondary`, `-hover`, `-pressed` — and ordered by
construction. Nyte's three fills are named for *where* they are used, which is
what let the ordering invert.

This is a real bug, it is visible, and it is a two-line fix independent of
anything else here.

---

## 5. The tint

`tokens.css`:

```css
--nyte-sidebar: hsl(from var(--nyte-sidebar-base) var(--nyte-tint-hue) var(--nyte-tint-intensity) l);
--nyte-editor:  hsl(from var(--nyte-editor-base)  var(--nyte-tint-hue) calc(var(--nyte-tint-intensity) * 0.5) l);
```

Two problems, both from HSL saturation being absolute rather than relative:

1. **Intensity is not a ratio.** `calc(i * 0.5)` asks the editor for half the
   sidebar's tint. Measured as oklch chroma, in light mode it delivers 9–11×,
   because the anchors sit at L 92% and L 99%. In dark mode both anchors are
   `#141414` and it lands near 2.0, so the defect is light-mode only.
2. **Ink never tints.** The tint reaches four anchors. `--nyte-text-primary`
   derives from `--nyte-base`, which is not one of them, so type measures
   0.0000 chroma at every intensity.

Notion's form is `color-mix(in oklab, var(--theme-N) var(--tint-intensity), var(--gray-N))`
applied at the *semantic* layer, so 0% is exactly neutral, 100% is exactly the
theme, and every token moves together.

---

## 6. What is actually worth taking

Ranked by value over cost.

1. **Fix the hover/selected inversion.** Not a migration. Two lines. §4.
2. **Add a solid twin per wash.** Makes `Reduce Transparency` mean something,
   and makes a translucent popover possible without the interior states
   double-compositing.
3. **Add per-hue wash ramps.** Absorbs the eight one-off literals in
   `tokens.css` and stops diff/status colours drifting from the ramp.
4. **Move the tint to `color-mix(in oklab, …)` at the semantic layer.** Fixes
   both §5 problems. Largest change; the settings UI already exists.
5. **`@scope` for modes.** Only if a nested theme is actually wanted. Nyte has
   no use case for one today, and `var()` substitution means every token has to
   be re-declared per boundary. Skip until something needs it.

Do not take: their radius naming, their spacing bag, their icon ramp (Nyte's is
better), their `-outline` shadows (Nyte already has them).
