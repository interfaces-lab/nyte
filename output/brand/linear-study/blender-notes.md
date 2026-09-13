# Linear two-object Blender study

This scene reproduces the supplied official Linear logo geometry as a material study. It is not a proposed Nyte logo.

The Artwork collection contains exactly two visible geometry objects:

1. A matte charcoal rounded-square base.
2. A single silver curve object containing all four closed logo contours.

The Lighting collection contains one front orthographic camera and two area lights. There are no additional geometry layers, image planes, or embedded textures. The Blender contour points come directly from `geometry.json`, which samples the official SVG path. The SVG remains the authoritative exact curve geometry.

## Files

- [Rendered PNG](blender-linear.png), 1024 × 1024 with alpha outside the base.
- [Editable Blender scene](linear-two-layer.blend).
- [Reproduction script](blender-linear.py).

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/linear-study/blender-linear.py
```

The script requires `geometry.json` beside it and Blender 5.2. Cycles renders on CPU with 64 samples and denoising. The first render took about eight seconds on this machine. Two renders were visually checked; the second adjusts the base reflectivity and the silver reflection.

## Construction

The base spans two units before its edge bevel, using a superellipse with exponent 4.6. The logo radius is 0.73 units. Each logo contour has a 0.018-unit straight extrusion and a 0.0035-unit bevel radius, giving a shallow 0.025-unit total thickness. All four contours share one material and remain editable together.

The silver material has metallic 0.65 and roughness 0.30. Its broad upper-left reflection comes from a four-unit softbox positioned at `(-0.7, 2, 4)`. A weaker right fill keeps the edge from disappearing. Contact shadows are rendered from actual shallow geometry. The camera is perpendicular to the base and uses an orthographic scale of 2.28 for a small transparent outer margin.

The study omits film grain. Its purpose is to isolate silhouette, edge relief, and lighting so those qualities can inform the scalable SVG version.
