# Fine ASCII mesh study

The three smaller sections contain 911 outlined ASCII glyphs with varying character density and three yellow brightness levels. The silver cap stays smooth at lower left. The smaller sections face upper right, and their characters remain upright.

## Files

- [Blender scene](ascii-mesh.blend)
- [1024 px PNG](blender-ascii-mesh.png)
- [Reproduction script](blender-ascii-mesh.py)

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/linear-ascii-mesh/blender-ascii-mesh.py
```

The script reads `geometry.json` beside it. It preserves its 911 source glyphs, three brightness groups, and 1,532 disconnected polygon components. Exterior and interior rings retain the outlined glyph shapes. The script converts them into Blender mesh geometry with a 0.002-unit total extrusion and no bevel, so fine strokes stay crisp. Emission strength is 0.12, and the three material colors come directly from the prepared geometry.

There are no ladder bars or continuous perimeter outlines. The source geometry counter-rotates the individual glyphs. Rotating the entire emblem 180 degrees places the smaller sections at upper right while leaving their characters upright.

The Artwork collection has exactly two visible objects, both actual meshes. The base is one mesh. The silver cap and yellow ASCII geometry share a second mesh with four material slots. The combined logo has 374,498 vertices and 279,315 faces. The high vertex count preserves the source glyph contours; it does not add more object layers.

The front orthographic camera and two area lights remain in a separate Lighting collection. The cap, charcoal base, and lighting match the preceding study. Cycles CPU uses 64 samples and denoising. Rendering the 1024 px RGBA PNG took 8.6 seconds on this machine.

The rendered image was inspected at full size. Distinct upright punctuation and denser glyphs are visible, with a gradual brightness change through the three sections. No original study, editor, or SVG files were modified.
