# Contract

Five people are building this package in parallel. Read this before touching
anything, and stay inside the files you own.

## What this package is

A blank room. StyleX and React, no Tailwind, no inherited palette, no product
CSS. It exists to answer one question properly: what does a strict,
Notion-Calendar-grade layering, dialog and spacing system look like when
nothing is inherited and nothing is fudged?

Everything visible must come from `src/tokens/*`. No component may write a
literal colour, a literal radius, a literal shadow, or a raw pixel gap.

## Hard rules

These come from the repository's `AGENTS.md` and are not negotiable.

- **No `any`. No type casts** — no `as T`, no chained assertions, no
  angle-bracket assertions. Use inference, narrowing, or `satisfies`.
  `as const` is allowed.
- **Erasable syntax only.** No enums, no parameter properties, no namespaces.
- **Top-level imports only**, including `import type`. No dynamic imports, no
  star imports, no renamed imports.
- Prefer `const`, early returns, dot notation.
- Comments earn their place. Explain a decision or a constraint, never restate
  the line below.
- British-neutral prose in comments. No em dashes in code comments.

## Source of truth

Every Notion value is already extracted and verified. Do not re-derive, do not
guess, do not "improve" a number.

- `docs/NOTION-TOKENS.md` in this package holds the audited values.
- Anything not in that file is DERIVED and must be commented as such.

## File ownership

Do not create, edit, rename or delete a file outside your own list. If you
need something from another area, read its file and code against it; if it is
missing, write against the contract below and leave a `CONTRACT:` comment.

| area | owner | files |
| --- | --- | --- |
| layers and elevation | A | `src/tokens/layer.stylex.ts`, `src/surfaces/surface.stylex.ts` |
| spacing and density | B | `src/tokens/space.stylex.ts`, `src/tokens/type.stylex.ts` |
| menu, submenu | C | `src/surfaces/menu.stylex.ts`, `src/surfaces/menu.tsx` |
| dialog | D | `src/surfaces/dialog.stylex.ts`, `src/surfaces/dialog.tsx` |
| shell and assembly | E | `src/shell/*`, `src/main.tsx`, `src/app.tsx` |

`src/tokens/color.stylex.ts` is shared and already written. Nobody edits it.

## The contract between areas

### Layers

One scale, one owner. Nothing may invent a `zIndex`.

```
base      0    the shell
raised    10   docked panels, the composer
popover   100  menus and popovers
submenu   110  a menu opened from a menu
scrim     200  the dialog backdrop
dialog    210  the dialog panel
```

A surface at layer N draws the shadow for layer N. The shadow scale and the
z scale move together; a component never picks a shadow by eye.

### Surfaces

`surface.stylex.ts` exports exactly three painted frames. Everything floating
uses one of them, and no component paints its own background, border or
shadow.

```
surface.flat      opaque, no shadow, no border     rail, pane
surface.raised    opaque, hairline, shadow-sm      cards, composer
surface.floating  the material, hairline, shadow   menus, submenus, dialogs
```

`surface.floating` is the only translucent thing in the package. It carries
the fill, the backdrop filter, the hairline, `background-clip` and the radius.
Nothing else may set `backdrop-filter`.

### Spacing

One 4px grid. `space.stylex.ts` owns it. Components read named steps, never
numbers.

Inset and gap are separate concerns and separate tokens. A menu's outer
padding is not the same decision as the gap between its items, and neither is
the same as the inset of an item's own label.

### Radius

Concentric by construction. An inner radius is `outer - inset`, computed from
tokens, never typed twice. If a surface has radius R and padding P, its
children have radius `R - P`. Provide this as a token or a helper, not as
arithmetic scattered through call sites.

### Items

A menu item, a dialog button and a shell row share one row anatomy: a leading
slot of fixed width, a flexible label, an optional trailing slot. The slots
are the same width everywhere so labels align across surfaces.

## Definition of done for your area

- `pnpm --dir packages/lab typecheck` passes.
- No literal colour, radius, shadow, z-index or spacing number in your files.
- Every DERIVED value carries a comment saying so and why.
- Your area renders correctly at both appearances.
