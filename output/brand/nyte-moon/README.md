# Nyte moon

Open `index.html` in a browser. It is self-contained: no network requests, works from `file://`.

## The mark

A crescent moon, nine cells across. The moon is a sphere built from unit cells, lit by a sun that sits to the right and a little behind, so a waxing crescent emerges from the shading. The dark side stays faintly visible as earthshine in night blue. Cursor took the pointer and made it a solid; Nyte takes the night and makes it a lattice of cells, the content-addressed objects the kernel is built on.

Amber on night. The crescent is the only warm thing on the page; everything else is slate on near-black.

## How it renders

Every character cell casts a ray through a 9×9×9 voxel grid and walks it one cell at a time. A hit yields the face entered and the point on the sphere. The sphere normal against the sun gives the phase; the face against the eye gives the facets, so stair-steps show inside the lit crescent as well as on the silhouette. Brightness picks a glyph from a density ramp and a colour from a three-stop amber gradient. The night side takes a slate ramp instead.

The background is real kernel source (`README.md`, `names.ts`, `lease.ts`, `effects.ts`, `step.ts` from `packages/core/src/kernel`) wrapped to the character grid by Pretext 0.0.8, bundled inline under its MIT licence (`PRETEXT-LICENSE`). The moon occludes the code beneath it and a soft vignette lets the code fall away toward the centre.

Drag to rotate, with inertia. Arrow keys nudge. The sun stays put, so the crescent holds while the cells turn beneath it. When idle the moon turns once every 51 seconds; `prefers-reduced-motion` stops it.

## Rebuild

`template.html` holds the page with two placeholders. `build.ts` inlines the Pretext bundle and the kernel source. From the repo root:

```sh
bun build node_modules/.pnpm/@chenglou+pretext@0.0.8/node_modules/@chenglou/pretext/dist/layout.js --format=esm --minify --outfile=/tmp/pretext.bundle.js
cp output/brand/nyte-moon/template.html /tmp/nyte-cube-template.html
bun run output/brand/nyte-moon/build.ts
```
