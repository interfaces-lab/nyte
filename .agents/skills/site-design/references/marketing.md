# Marketing surfaces

Paths are under `packages/docs/src`. Tokens live in `app/global.css`.

## The plate

The landing hero sits on `.landing-plate`: a card inset from the viewport by `--plate-inset`
(12px, 8px under 640px) with `--plate-radius` (28px, 24px). It runs from deep blue through
`--hero-blue` (#2222dd) and a lighter lift to a pale haze, under a grain overlay and a hairline
border. Dark mode swaps in a navy ramp.

- Text on the plate is white; secondary text is `text-white/72`.
- The headline is Geist Pixel, `clamp(2.75rem, 1.1rem + 4.6vw, 4.75rem)`, leading 1.02,
  balanced. Keep it to four words or fewer.
- `landing-plate-fade` turns the plate into the page background behind the preview, so the
  preview reads as sitting on paper.
- Entrance: `animate-plate-rise`, staggered 0, 90, 180, and 260ms. The preview rises 40px; text
  rises 12px.

## Nav on the plate

`components/site-nav/site-nav.tsx` is shared with docs and Cloud. On the landing it is fixed in
the plate's corner; `--plate-nav-drop` keeps its pills concentric with the plate radius.

- `hero:` styles paint it white on blue.
- `NavSentinel` sets `html[data-nav-stuck]` when the top of the preview passes under the nav.
  `stuck:` then fades in a frosted bar and the nav returns to normal colours.
- The nav never moves when it changes state. White text never sits on a light surface.

## Calls to action

Use `KeyLink`: a pill (`h-9 rounded-full`) with a single-letter shortcut in a `kbd` suffix. The
shortcut is ignored while the visitor is typing.

- Primary: white fill, `--plate-ink` text.
- Secondary: `bg-white/10`, `ring-white/15`, backdrop blur.
- Two at most. "Install Nyte" (I) and "Read the docs" (D) are the current pair.

## Fact words

`components/landing/plate/fact-word.tsx` and `.fact-pill` in `global.css`.

A word in a sentence that, on hover or focus, throws two facts about itself.

- The word has a dotted underline and links to the page that backs the claim.
- Two mono pills, 11px, sentence case: one above tilted -7°, one below tilted +5°.
- They scale from 0.8 and rotate in on `cubic-bezier(0.34, 1.56, 0.64, 1)` over 420ms; the second
  starts 40ms later. While hovered they drift 0.3 times the pointer's offset from centre.
- Reduced motion: they fade in at their final angle and do not drift.
- Pastel tint behind `--plate-ink` text. Current tints: pink `#ffd6e8`, violet `#e3dcff`, cyan
  `#c8f3ff`. One tint per word.
- Three fact words per sentence at most. Labels are nouns or short noun phrases, about 22
  characters at most, and each must pass [copy.md](copy.md).

## Product preview

`components/landing/plate/host-stage.tsx`.

- A square-cornered panel. `--panel` is the foreground mixed 4% into the background, so it is
  opaque in both themes. It has a hairline border and a 14px dot grid masked to fade from the top.
- The hosts sit in `Bezel` frames and run off the bottom of the panel into a fade.
- The dock is the only switch: 48px squircle tiles, a tooltip on hover or focus, and a dot under
  the active host. The tile lifts 4px on hover and presses to 0.94.
- Every host shows the same session, "Migrate stored runs on open". The fixtures must match the
  real UI in `packages/tui`, `packages/app`, and `packages/mobile`; update them when that UI
  changes.

## Below the hero

`InstallCard` is the only section so far. A new section is a coverage gap until the user
accepts a pattern for it.
