# Nyte moon app icon study

Open `index.html` directly. The three concepts reuse the 9×9×9 voxel sphere, initial rotation, and directional lighting from `../nyte-moon/template.html`. The original design is unchanged.

- `nyte-moon-ascii`: literal glyph rendering.
- `nyte-moon-solid`: recommended app-icon direction, solid voxel shading.
- `nyte-moon-hybrid`: solid shading with glyph texture over the lit side.
- `nyte-moon-foreground`: transparent solid moon layer.
- `nyte-moon-background`: opaque midnight background layer.

Each is supplied as a 1024×1024 PNG and an SVG. Files have square bounds; rounded corners appear only in the HTML preview. The foreground SVG uses many sampled spans, so the PNG layer is the simpler import for Icon Composer. The ASCII SVG uses a monospace font; the PNG fixes its rendered appearance.

These are visual concepts, not an installed app icon or validated `.icon` package. Check the layers and all system appearances in Icon Composer before shipping. Small previews are scaled from the same artwork; they are not separately hand-tuned assets.

Browser verification covered all 15 icon previews, PNG/SVG export, and mobile overflow.

Apple guidance: https://developer.apple.com/design/human-interface-guidelines/app-icons

## Live SVG moon editor

Open `moon-editor.html` for the interactive ASCII and horizontal-band moon. Adjust rightward tilt, horizontal position, light phase and direction, moonlight, earthshine, gloss strength, highlight width, band spacing, and character size. Presets include a monochrome band treatment inspired by the supplied reference. Drag and arrow keys rotate the original voxel geometry. No autoplay or inertia is used.

The preview is native SVG. Export SVG creates square artwork with a `viewBox`, vector paths and reusable outlined JetBrains Mono glyphs. It contains no bitmap images, text elements, or external font references. JetBrains Mono's license is included in `JETBRAINS-MONO-LICENSE`; Pretext remains bundled for background code layout. Background code is omitted from icon exports.

Settings persist in browser local storage. `moon-editor.js` is the editable source, inlined into the HTML so the editor opens directly from disk. `nyte-moon-editor-export.svg` is a verified default sample.
