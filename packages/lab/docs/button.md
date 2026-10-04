# Button

The one control primitive. Toggle, ToggleGroup items, Tabs pills, SplitButton,
and ButtonLink all compose `buttonStyle()`; nothing else paints a clickable
box. A Select or Menu trigger is a Button with a chevron, never its own look.

Source: `packages/ui/src/button.tsx`. Measurements: `--nyte-btn-*` in
`packages/ui/src/tokens.stylex.ts`. Colour: `role.*` under an `intent` scope.

## Anatomy

```text
<button>                      height = btn-height-{size}, radius = btn-radius-{size}
  ::before                    hit area padded out to target.min (24 / 44 coarse)
  <ControlGlyphs>
    <span content>            gap = btn-gap-{size}
      <Icon?>                 glyph size from the size ramp
      {children}
    <span spinner?>           replaces content while loading, keeps width
```

## Axes

The same shape a `cva` config would take. Every value is a name that exists today
unless marked **new**.

| axis | values | default | what it decides |
| --- | --- | --- | --- |
| `variant` | `ghost` `outline` `solid` `plain` `text` `inline` | `ghost` | fill, edge, weight |
| `size` | `2xs` `xs` `sm` `md` `lg` `xl` | `md` | height, padding, radius, gap, glyph |
| `round` | `false` `true` | **new:** `variant === "ghost"` | square corner from the size ramp, or pill |
| `tone` | `neutral` `primary` `success` `warning` `danger` | `neutral` (`text` → `primary`) | which hue ramp the roles resolve in |
| `iconOnly` | `false` `true` | `false` | square of the height; `aria-label` required |
| `loading` | `false` `true` | `false` | spinner over content, `aria-busy` |
| `disabled` | `false` `true` | `false` | opacity .5 on the whole control |
| joined | context from `ButtonGroup` | — | shared edge, one radius on the ends |

### `variant`

| name | fill | edge | weight | hover | reads as |
| --- | --- | --- | --- | --- | --- |
| `ghost` | none | none | 500 | `layerHover` | a verb on a surface, a status chip |
| `outline` | `bgElevated` | inset 1px `borderPrimary` + `shadowSm` | 500 | `layerHover` | the action in a row, every dropdown trigger |
| `solid` | `buttonFill` | none | 500 | `buttonFillHover` | the one primary action in a dialog or form |
| `plain` | none | none | 400 | `layerHover` | a row that navigates, a link in a list |
| `text` | none | none | inherit | underline | a link inside prose or a caption |
| `inline` | none | none | inherit | tinted halo | a chip inside a sentence |

Pressed and `aria-expanded` lift `ghost` and `plain` to
`bgInteractiveSecondaryTranslucent` so an open menu's trigger stays marked.

### `size` ramp

From `tokens.stylex.ts`; fine pointer, coarse in brackets.

| size | height | pad | pill pad | radius | gap | font / leading | glyph (text / icon-only) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2xs` | 16 (28) | 4 | 6 | 4 | 4 | sm 12 / 16 | 12 / 12 |
| `xs` | 20 (32) | 6 | 6 | 4 | 4 | sm 12 / 16 | 12 / 12 |
| `sm` | 24 (36) | 8 | 10 | 6 | 6 | base 13 / 18 | 14 / 14 |
| `md` | 28 (40) | 8 | 10 | 8 | 6 | base 13 / 18 | 14 / 16 |
| `lg` | 32 (44) | 10 | 12 | 8 | 8 | base 13 / 18 | 14 / 16 |
| `xl` | 36 (48) | 12 | 12 | 10 | 8 | base 13 / 18 | 16 / 18 |

`md` is the settings row control height (`--nyte-settings-control-height`
already points at it). `sm` is for dense toolbars and tray rows. `xl` is the
composer send.

### `tone`

`tone` scopes the button to a hue theme (`intent.primary` = blue ramp,
`success` = green, `warning` = yellow, `danger` = red). The variant keeps
reading the same roles; the ramp underneath changes. No variant owns a colour.

```text
tone="danger" variant="outline"   border/label from the red ramp, same fill and shadow
tone="success" variant="ghost"    label from the green ramp, no fill
```

`destructive` is therefore not a variant. It is `tone="danger"` on `solid`
(dialog confirm) or `outline` (row action).

## Proposed changes

Two defaults move; no new tokens, no new variants.

1. **`round` defaults to `true` for `ghost`.** A transparent control has no
   edge to square against, so it reads as a capsule. `outline` and `solid`
   keep the size radius so they sit flush beside inputs (`input-radius-md` =
   `btn-radius-md` = 8).
2. **A dropdown trigger is `outline` + `chevron-down` 12.** `SelectTrigger`
   drops its own geometry (24 tall, radius 6, `fontSm`, translucent fill,
   `chevron-up-down` 11) and renders through `buttonStyle("outline", "md")`
   with the chevron as its icon. `SelectContent` takes `radius.surface` like
   `MenuContent`.

## Which one

Decided by what the control does, not where it sits.

| the control… | use |
| --- | --- |
| is the one thing to do here | `solid md` |
| does a thing, or opens a menu of things | `outline md`, chevron-down 12 if it opens |
| picks one of a few | `outline md` through Select, chevron-down 12 |
| shows a state that holds verbs (Connected) | `ghost md` round, tone, dot + chevron-down 12 |
| overflows (`···`) | `ghost md` round `iconOnly` |
| leads somewhere | `plain md`, chevron-right 12 |
| sits in prose | `text` or `inline` |
| ends a dialog | `outline md` cancel, `solid md` confirm, `tone="danger"` when destructive |
