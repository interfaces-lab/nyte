# Desktop icon assets

The artwork is a 12-cell dithered moon lit from the upper left, `#c1d0f6` on a plate that fades from `#232a44` to `#0c1020`. The docs site's design mark, `moonCells` in `packages/docs/src/components/design-site/mark.tsx`, draws the same cells. The moon spans 64% of the plate on every platform.

| File | What it is |
| --- | --- |
| `icon.svg` | The plate without padding, corner radius 26.8% |
| `icon.ico` | `icon.svg` at 16 to 256px, for Windows |
| `icon-macos.svg` | An 824px plate on the 1024px canvas, radius 22.5%, with the drop shadow in the margin, following Apple's macOS icon grid |
| `icon.png` | The 1024px render of `icon-macos.svg` |
| `icon.icns` | The macOS icon sizes, generated from the padded render |
| `icon-ios.svg` | The same artwork on a square plate, with no Dock padding and no corner radius, because iOS applies its own mask |
| `icon-ios.png` | The 1024px opaque render of `icon-ios.svg`. The mobile app's `app.json` points at it |
| `../resources/icon.png` | The 256px `icon_128x128@2x.png` image extracted from `icon.icns` with `iconutil`. Development builds set it as the Dock icon |

Sizes below 128px are redrawn rather than shrunk, so every square lands on whole pixels. The 64px icon uses 8 cells, and 32px and below use 5. Packaged apps show their bundle icon and set no Dock icon at run time.

## Development bundle

On macOS, `scripts/dev.mjs` copies Electron's app bundle to `Nyte (Dev).app`, puts `build/icon.icns` in its `Contents/Resources` and sets `CFBundleIconFile` before ad-hoc signing. Mission Control and other views that read the bundle icon then show the Nyte icon, which the Dock PNG alone doesn't give them. The installed Electron bundle stays untouched.

The copy is cached under `node_modules/.cache/nyte-electron`. The cache key holds the Electron version, the architecture and a hash of the ICNS, the preparer script and the development URL scheme. A change to any of them prepares a fresh bundle at a new path on the next dev start. An interrupted preparation starts again from a clean copy.

## Change the artwork

1. Regenerate `icon-macos.svg`, `icon.png` and `icon.icns` together, keeping the padding at every size.
2. Extract `../resources/icon.png` from the new ICNS.
3. Regenerate `icon-ios.svg` and `icon-ios.png`. The iOS plate stays square and opaque.

To check the development bundle without launching Electron, run this from `packages/desktop`:

```sh
pnpm exec node --test scripts/test-dev-icon.mjs
```

The test runs only on macOS. It builds temporary bundles and checks the icon, the plist, the signature, cache reuse and invalidation.
