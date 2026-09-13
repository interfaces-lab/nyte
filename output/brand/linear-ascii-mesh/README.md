# Fine ASCII sections

This version replaces the rejected coarse lattice with the fine character field shown in the user's original moon reference. The three smaller sections remain at the upper right; the large cap remains smooth silver.

The default field uses 911 outlined JetBrains Mono glyphs selected from ` .:-=+*#%@` by crescent-style directional brightness. There are no continuous perimeter rails or ladder bars. Characters remain upright at the default 180-degree emblem rotation.

## Files

- `index.html`: Figma-style selector with position, scale, rotation, cap material, character spacing, glyph size, and yellow color controls.
- `ascii-mesh.blend`: two visible mesh objects, base and combined emblem. The glyphs are actual shallow geometry, not a texture.
- `blender-ascii-mesh.png`: 1024px render.
- `blender-ascii-mesh.py` and `geometry.json`: reproducible Blender construction.
- `ascii-mesh-icon.svg`: two-layer icon export.
- `ascii-mesh-logo.svg`: transparent emblem export.
- `glyph-outlines.json` and `JETBRAINS-MONO-LICENSE`: source outlines and font license.

SVG exports contain outlined glyph geometry, internal references and clipping. No font installation or embedded bitmap is required. The cap uses SVG lighting filters; glyphs retain crisp vector outlines. Browser edits do not rebuild the static Blender scene automatically.

The earlier coarse-lattice and official-logo studies remain unchanged. Browser checks covered default orientation, spacing and size controls, persistence, layer selection, Blender reference, SVG parsing, and mobile overflow.
