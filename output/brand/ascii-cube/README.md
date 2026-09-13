# Nyte ASCII cube

Open `index.html` directly in a browser. It is self-contained and makes no network requests.

The open orbit holds a diamond checkpoint, with a second diamond at its opening. It takes its cue from Nyte's saved history and ability to continue from a durable point. This is an identity concept, not a replacement for the app's current assets.

Drag the cube or use arrow keys. Home and Reset view restore the initial angle. Auto-rotate is opt-in; changing the system preference to reduced motion pauses it. Cell size controls the ASCII resolution. Download mark exports the same SVG path used on the cube faces.

The renderer casts a perspective ray through each character cell, intersects a rotated cube, samples the orbit symbol on the visible face, and maps directional lighting to glyph density. Pretext 0.0.8 wraps captured source from `packages/core/src/kernel/hash.ts` and `queue.ts` into the space around the projected cube silhouette. Pretext is bundled inline under the included MIT license.

`desktop.png` and `mobile.png` are browser captures. `nyte-mark.svg` is the exported mark.
