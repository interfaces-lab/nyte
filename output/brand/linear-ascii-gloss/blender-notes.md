# Smooth blue and gold icon

The current design has four smooth solid sections. The large cap is opaque smoky blue with a broad diagonal reflection. Three smaller gold sections face upper right. All ASCII characters, lattice patterns, and perforations have been removed.

The folder and output filenames retain `ascii` only to keep existing editor links working. They do not describe the current artwork.

## Files

- [Blender scene](ascii-gloss.blend)
- [1024 px PNG](blender-ascii-gloss.png)
- [Reproduction script](blender-ascii-gloss.py)

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/linear-ascii-gloss/blender-ascii-gloss.py
```

The script reads only the four original contours in `../linear-study/geometry.json`. It does not read the previous glyph geometry. The original source is unchanged.

## Construction

The Artwork collection contains exactly two visible geometry objects: the near-black navy base and one joined emblem. The emblem has four solid contours, two material slots, 27,971 vertices, and 26,034 faces. There are no character shapes or lattice holes. The only internal gaps are the original three stripe separations.

The gold sections have 0.02-unit extrusion with a clamped bevel up to 0.003 units. Their shared material uses metallic 0.55, roughness 0.24, coat weight 0.45, and coat roughness 0.16. The large cap uses 20 interior mesh rings and shallow curvature up to 0.055 units. It stays fully opaque. Its smoky-blue color gradient runs toward graphite, with metallic 0.48, roughness 0.18, coat weight 0.8, and coat roughness 0.12.

The diagonal reflection comes from a rectangular area light reflecting in the curved cap. That light is 3.4 units long and 0.26 units wide, with 45 W power and a 45-degree diagonal orientation. A broad upper-right key lights the gold and a weaker cool fill lights the left. Camera and three lights are in a separate Lighting collection.

Two local render passes were inspected. The second replaced the gold curve bevel with a clamped bevel to remove a small tip artifact. The final 1024 px RGBA render has smooth surfaces, a clear blue reflection, and no patterned texture. Cycles CPU used 64 samples and denoising, taking 7.6 seconds. Earlier study folders and SVG/editor files were preserved.
