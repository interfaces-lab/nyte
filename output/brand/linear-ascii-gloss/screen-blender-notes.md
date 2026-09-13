# Fine layered metal screens

This study uses two closely spaced perforated metal sheets. The visible texture comes from thousands of small rounded-square openings and the darker sheet behind them. There are no letters, image textures, or large ladder openings.

## Files

- [Blender scene](screen-mesh.blend)
- [1024 px icon render](blender-screen-mesh.png)
- [768 px camera detail render](blender-screen-mesh-detail.png)
- [Reproduction script](blender-screen-mesh.py)

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/linear-ascii-gloss/blender-screen-mesh.py
```

The script reads `screen-geometry.json` beside it. The previous smooth scene, its render, and the SVG/editor files are unchanged.

## Real layered openings

The prepared geometry contains 3,998 front openings and 3,901 rear openings. Density is 84 pitches across the emblem diameter. Hole width is 60% of pitch, rows are staggered by half a pitch, and the rear sheet is offset by 28% of pitch. These positions come directly from the prepared geometry.

Both sheets have about 0.0022-unit total thickness, including a 0.0002-unit edge bevel. Front top height is 0.020 units. Rear top height is 0.015117 units, giving a 0.004883-unit separation, equivalent to the requested 2.5 px on a two-unit 1024 px base. Both sheets share a shallow 0.025-unit dome. This keeps the two sheets parallel while giving the metal a continuous lighting response.

The original large cap is at lower left and the three gold stripes are at upper right. All four front and rear regions are joined into one emblem object. The Artwork collection contains exactly two visible objects: base and emblem. The emblem has four material slots, 847,360 vertices, and 773,000 faces. The layered holes remain editable geometry.

## Materials and lighting

Front graphite-blue and warm gold have continuous color gradients, metallic 0.55, roughness 0.29, and a light clearcoat. The rear sheet uses darker versions of the same colors, higher roughness, and lower specular response. This makes the rear offset visible inside the front openings. A broad upper-left key gives the sheet faces and pore edges their reflection, with a warm upper-right reflection light and a weak cool fill.

Camera and three lights are in a separate Lighting collection. The saved scene opens with the full-icon front orthographic camera. The script also renders a closer camera view to show the pore walls and offset rear layer.

## Verification

Before rotation and joining, the script casts a ray through the center of every prepared interior hole in each sheet separately. All 7,899 checks passed. The full render and macro render were inspected twice. The second iteration warmed the gold and darkened the rear sheet so the openings read clearly.

The final full icon render took 12.9 seconds on CPU. The macro view took about another 6.4 seconds. Both use Cycles with 64 samples and denoising. QA used local rendered images; no live browser inspection was performed.
