# Desktop icon assets

- The artwork is the dithered moon from the docs download tile (`packages/docs/src/components/landing/plate/dither-moon.tsx`): a 12-cell disc lit from the upper left, `#c1d0f6` on a `#232a44` to `#0c1020` plate. The moon spans 64% of the plate on every platform.
- `icon.svg` is that tile unpadded, corner radius 26.8% as on the site. `icon.ico` renders it at 16 to 256px for Windows.
- `icon-macos.svg` places an 824px plate on the 1024px canvas, radius 22.5%, with the drop shadow in the margin, following Apple's macOS grid.
- `icon.png` is the 1024px render of `icon-macos.svg`.
- Sizes below 128px are redrawn, not shrunk: 64px uses 8 cells and 32px and below use 5, so every square lands on whole pixels.
- `icon-ios.svg` is the same artwork on a square plate: no Dock padding and no baked corner radius, because iOS applies its own mask.
- `icon-ios.png` is the 1024px opaque render. The iOS app points at it; using `icon.png` left a white strip inside the system squircle.
- `icon.icns` contains the macOS icon sizes, generated from that padded render.
- `../resources/icon.png` is the 256px `icon_128x128@2x.png` representation extracted from `icon.icns` with `iconutil`. Development uses this PNG for the Dock. Packaged apps retain their bundle icon without a runtime override.

On macOS, `scripts/dev.mjs` also copies `build/icon.icns` into the cached `Nyte (Dev).app/Contents/Resources` and sets `CFBundleIconFile` before ad-hoc signing. This gives Mission Control and other bundle-based views the Nyte icon; the runtime Dock PNG alone does not. The installed Electron bundle stays untouched.

The dev bundle cache key includes the Electron version, architecture, and a content hash of the ICNS and preparer script. Changing either file prepares a fresh bundle at a new path on the next dev start. Incomplete preparation is retried from a clean copy.

When changing the artwork, regenerate the padded SVG, PNG, and ICNS together, then extract the development PNG from the new ICNS. Preserve the padding at every size. Also regenerate `icon-ios.svg` and `icon-ios.png`: the iOS plate stays square and opaque.

Verify bundle preparation without launching Electron with `pnpm exec node --test scripts/test-dev-icon.mjs`. The macOS-only test uses temporary bundles and checks the icon, plist, signature, cache reuse, and invalidation.
