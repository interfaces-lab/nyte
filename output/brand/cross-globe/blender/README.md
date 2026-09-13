# Nyte relief lighting study

Supplementary Blender reference for the SVG editor. This render is a lighting study, not an SVG replacement or a production app icon.

- [Rendered study](nyte-relief-study.png), 768 × 768 RGBA PNG, transparent outside the base.
- [Editable scene](nyte-relief-study.blend), Blender 5.2.
- [Reproduction script](relief-study.py).

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python output/brand/cross-globe/blender/relief-study.py
```

The script samples the editor's quadratic band formula and clips each band against a 256-sided circle. Three bands per family cross at 45 and 135 degrees. Band width is 15% of the mark diameter, spread is 86%, and curvature is 8%. The mark diameter is 66% of the base width. The upper family lies continuously above the lower family.

The base is a superellipse with exponent 4.6. Each band is a shallow solid with a 0.003-unit bevel on a 2-unit icon, equivalent to about 1.5 px on a 1024 px base. Lower bands rise 0.026 units above the base and upper bands rise 0.044 units, about 13 and 23 px respectively. This is intentionally shallow relief. The upper bands use pale satin gold at roughness 0.24 and metallic 0.48; the lower bands are warmer and darker.

Lighting uses a 4.2-unit area light at upper left and a weaker cool fill on the right. An orthographic camera is almost perpendicular to the base. Cycles CPU uses 40 samples and denoising; the measured render took about three seconds on this machine. Two renders were visually checked to refine the gold and base colors.

For SVG translation, preserve the mark geometry, use a thin lit edge facing upper left, darken the side face facing lower right, and put the narrow contact shadow immediately below the relief. Broad gradients should describe the metal face without inflating the bands into a sphere.
