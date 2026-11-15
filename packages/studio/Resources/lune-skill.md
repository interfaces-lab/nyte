---
name: lune
description: Read, write and check Lune design files (*.lune), the designs Nyte Studio shows on its canvas. Use when asked to design or change a screen, component, token or theme in a project that has .lune files, or to turn a design into code.
---

# Lune

A Lune file is a design written as markup. Nyte Studio draws every `.lune` file in the project on
one canvas and redraws a file the moment it changes, so you change a design by editing its file.
Whoever is at the canvas sees each edit land.

## Elements

| Element     | What it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `<frame>`   | An artboard. Top level only. Takes `name`, `x`, `y`, `w` and optionally `h` |
| `<col>`     | Children stacked top to bottom                                             |
| `<row>`     | Children side by side                                                      |
| `<box>`     | Children layered on top of each other, first at the back                   |
| `<text>`    | Text. The content is the text                                              |
| `<image>`   | A picture. `src` is relative to the file, `fit` is `cover`, `contain` or `fill` |
| `<icon>`    | An SF Symbol. `name` is the symbol, `size` and `color` set it              |
| `<ellipse>` | An ellipse that fills its `w` and `h`                                      |

A frame stacks its children like a `<col>`. Give it `layout="row"` or `layout="box"` to change that.

Whitespace inside `<text>` collapses to single spaces, as in HTML. `<br/>` breaks the line.

## Attributes

Size and place:

- `w`, `h`: a number of points, `fill`, `hug` (fit the contents, the default) or a percentage of
  the parent. `fill` takes the space the parent has left inside its padding: along a stack that is
  what the other children leave, shared equally between everything that fills, and across it the
  stack's whole width or height. An empty `<box h="fill" />` in a `col` is a spacer that pushes
  what follows to the bottom.
- `x`, `y`: on a frame, where it sits in its file. On anything else, the element leaves the flow
  and is placed from its parent's top-left corner. A number or a percentage.

Stacks (`frame`, `col`, `row`, `box`):

- `gap`: space between children.
- `pad`: `"16"`, `"12 16"` or `"top right bottom left"`.
- `align`: across the stack: `start`, `center`, `end` or `stretch`. On a `box`, one word for both
  axes or two for horizontal then vertical.
- `justify`: along the stack: `start`, `center`, `end` or `between`.
- `self` on a child overrides its parent's `align` for that child.

Paint:

- `fill`: `#rrggbb`, `#rrggbbaa`, `linear(angle, color, color 70%)`, `radial(color, color)` or
  `none`. The angle is in degrees, clockwise from pointing up.
- `stroke` and `stroke-w`: a colour and a width, drawn inside the edge.
- `radius`: one number, or four for top-left, top-right, bottom-right, bottom-left.
- `shadow`: `"x y blur color"`, several separated by commas.
- `opacity`: 0 to 1. `clip` cuts children off at the element's edge. `hidden` removes it.

Text:

- `style`: a type token, such as `$title`. `size`, `weight` (100 to 900), `leading` (line height)
  and `tracking` on the same element override that part of the style and keep the rest.
- `color`, `align` (`start`, `center`, `end`), `lines` (the most lines to show), `italic`.
- `font`: a family name, or `system`, `mono`, `serif` or `rounded`. Inter is the default.

## Tokens

```xml
<tokens>
  <color name="accent" value="#3f58a8" dark="#c1d0f6" />
  <number name="radius.card" value="28" />
  <type name="title" size="20" weight="600" leading="26" tracking="-0.3" />
</tokens>
```

Use a token as `$accent` anywhere a value goes, including inside `linear(...)`. A number token
works for any number: `gap="$space.section"`, `pad="$space.page"`, `radius="$radius.card"`. A
colour's `dark` is its value by night. A frame with `theme="dark"` resolves every colour inside it
to its dark value, so a day and a night version of a screen can sit side by side.

## Components

```xml
<component name="Button" label="Continue" fill="$accent">
  <row h="52" pad="0 22" radius="14" fill="{fill}" align="center" justify="center">
    <text style="$label" color="$on.accent">{label}</text>
  </row>
</component>

<Button w="fill" label="Save" />
```

The attributes of `<component>` other than `name` are its props, with their defaults. `{prop}`
fills a prop into an attribute or into text. A component has one root element. On an instance, an
attribute that is a prop sets the prop; any other attribute overrides the root element. Above,
`label` is a prop and `w="fill"` lands on the root `<row>`. `<Button stroke="$line" />` would add a
stroke to that row too, because `Button` has no prop named `stroke`.

A component can hold a whole screen. To show one screen by day and by night, put its contents in a
component and use it in two frames:

```xml
<component name="Welcome">
  <col w="fill" h="fill" pad="72 24 34 24" gap="40">…</col>
</component>

<frame name="Welcome" x="0" y="0" w="390" h="844" fill="$sky"><Welcome /></frame>
<frame name="Welcome · night" theme="dark" x="450" y="0" w="390" h="844" fill="$sky"><Welcome /></frame>
```

## Files

```xml
<use src="./tokens.lune" />
<use src="../controls.lune" />
```

`use` brings in another file's tokens and components, and those of the files it uses. Keep tokens
in one file, components in files of their own, and screens in files that use both: a change to a
token or a component then reaches every screen.

## How to work

1. Read the tokens and components before adding anything. Reuse them.
2. Change the token or the component when the request is about the look everywhere, and the screen
   when it is about one place.
3. Use tokens for colours, type and radii. A raw value in a screen is a value someone will have to
   find again.
4. Edit the smallest part of the file that does the job. The designer's own edits are in the same
   file, and a small diff is one they can read.
5. Check before you say it is done.

## Check your work

The `lune` command ships inside Nyte Studio. It needs neither the app running nor a display.

```sh
LUNE="/Applications/Nyte Studio.app/Contents/MacOS/lune"

"$LUNE" check design/screens/tonight.lune
"$LUNE" frames design/screens/tonight.lune
"$LUNE" render design/screens/tonight.lune --frame "Tonight" --out /tmp/tonight.png
```

`check` reports parse errors, unknown components, misspelt attributes and missing files, with
line numbers. It can't see taste: a line that wraps badly or a button nobody can read passes. So
`render` a frame and open the PNG. It is drawn by the renderer the canvas uses. Without `--frame`,
every frame is written into the `--out` folder, named after the frame in lower case with hyphens
(`Welcome · night` becomes `welcome-night.png`). `--theme dark` renders by night and `--scale 1`
makes a smaller image. Paths in `use` and `src` resolve from the project root: the nearest folder
above the file that holds `.git`, or the folder `--root` names.

## Turning a design into code

A Lune file says what a screen is made of, not how to build it. Map tokens to the project's own
tokens, components to its own components, and stacks to its layout primitives. Where the project
has no equivalent, say so instead of inventing one.
