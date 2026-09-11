# Desktop icon assets

- `icon-settings.json` preserves the selected D1 sleepy cloud settings.
- `icon.svg` is the D1 SVG artwork with a rounded macOS tile.
- `icon-macos.svg` adds transparent padding around that artwork. Its solid tile spans 412 of 512 units, matching the inset measured in OpenCode's macOS icon.
- `icon.png` is the 1024px render of `icon-macos.svg`.
- `icon.icns` contains the macOS icon sizes, generated from that padded render.
- `../resources/icon.png` is the 256px `icon_128x128@2x.png` representation extracted from `icon.icns` with `iconutil`. Development uses this PNG for the Dock. Packaged apps retain their bundle icon without a runtime override.

On macOS, `scripts/dev.mjs` also copies `build/icon.icns` into the cached `Nyte (Dev).app/Contents/Resources` and sets `CFBundleIconFile` before ad-hoc signing. This gives Mission Control and other bundle-based views the Nyte icon; the runtime Dock PNG alone does not. The installed Electron bundle stays untouched.

The dev bundle cache key includes the Electron version, architecture, and a content hash of the ICNS and preparer script. Changing either file prepares a fresh bundle at a new path on the next dev start. Incomplete preparation is retried from a clean copy.

When changing the artwork, regenerate the padded SVG, PNG, and ICNS together, then extract the development PNG from the new ICNS. Preserve the padding at every size.

Verify bundle preparation without launching Electron with `pnpm exec node --test scripts/test-dev-icon.mjs`. The macOS-only test uses temporary bundles and checks the icon, plist, signature, cache reuse, and invalidation.

Reference: [OpenCode's macOS icon notes](https://github.com/anomalyco/opencode/blob/v2/packages/desktop/icons/README.md).
