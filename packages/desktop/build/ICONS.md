# Desktop icon assets

The artwork is two circles on a grid of 8 cells. The moon has a radius of 3 cells and sits at the plate's centre, with a notch the size of the light cut from its rim. The light has a radius of 2 cells and sits in the notch, √2 cells from the moon's centre. With no turn it is one cell up and one cell right of that centre. The saved design turns the mark 20° clockwise, which puts the light's centre at (5.28, 3.40).

The moon and the light are two pieces of glass, the moon in front. Both are 40% see-through. macOS throws its own shadows straight down, so a faint shadow of the moon on the light is also painted in, as a picture layer on the light.

The icon has two looks.

| Look | Plate | Moon | Light |
| --- | --- | --- | --- |
| Night | `#232a44` to `#0c1020` | `#647fcb` at the light, paling to `#c1d0f6` | `#fff9d8` |
| Day | `#d4dffb` to `#aabdec` | `#4862b1` at the light, paling to `#8ea6e6` | `#ffffff` |

macOS 26 and later pick the look from the Icon & widget style setting. Default shows the day look, even when the system is in dark mode, and Dark shows the night look. Every other file here is the night look.

| File | What it is |
| --- | --- |
| `icon.icon` | The Icon Composer document. The moon is one group, the light and the painted shadow another, and it holds both looks |
| `Assets.car` | `icon.icon` compiled with `actool`. macOS 26 and later draw the app icon from it as Liquid Glass. `CFBundleIconName` in the packaged app's `Info.plist` names it |
| `icon.icns` | The night look for macOS before 26 and for development builds. An 824px plate on the 1024px canvas with the drop shadow in the margin, following Apple's macOS icon grid |
| `icon.png` | The 1024px image from `icon.icns` |
| `../resources/icon.png` | The 256px image from `icon.icns`. Development builds set it as the Dock icon |
| `icon.ico` | The night look without padding at 16 to 256px, for Windows |
| `icon.svg` | The night look as flat SVG, without padding, corner radius 26.8% |
| `icon-macos.svg` | The flat SVG with the 824px plate on the 1024px canvas. The app shows it in its About window |
| `icon-ios.svg` | The flat SVG on a square plate, with no padding and no corner radius, because iOS applies its own mask |
| `icon-ios.png` | The 1024px opaque render of `icon-ios.svg`. The mobile app's `app.json` points at it |

`Assets.car`, `icon.icns`, `icon.png`, `icon.ico` and `../resources/icon.png` are pictures of `icon.icon` as macOS lights it. The SVG files are drawn flat from the same circles, for the places that need a vector.

The web app's and the docs site's `icon.svg` are copies of `icon-macos.svg`. The docs site's `app-icon.png` is a copy of `../resources/icon.png`, and its `apple-icon.png` is `icon-ios.png` at 256px.

Each bitmap size is rendered at that size, not shrunk from a larger one. Packaged apps show their bundle icon and set no Dock icon at run time.

## Development bundle

On macOS, `scripts/dev.mjs` copies Electron's app bundle to `Nyte (Dev).app`, puts `build/icon.icns` in its `Contents/Resources` and sets `CFBundleIconFile` before ad-hoc signing. Mission Control and other views that read the bundle icon then show the Nyte icon, which the Dock PNG alone doesn't give them. The installed Electron bundle stays untouched.

The copy is cached under `node_modules/.cache/nyte-electron`. The cache key holds the Electron version, the architecture and a hash of the ICNS, the preparer script and the development URL scheme. A change to any of them prepares a fresh bundle at a new path on the next dev start. An interrupted preparation starts again from a clean copy.

## Change the artwork

Icon Composer, `ictool` and an `actool` that reads `.icon` files ship with Xcode 26 and later. `ictool` is inside Icon Composer's app bundle, under `Contents/Executables`.

1. Edit `icon.icon` in Icon Composer. It cannot turn a layer, so a turn means drawing the moon, the light and the shadow picture again.
2. Compile `Assets.car`. `actool` names the icon after the file, and the packaged app asks for `Icon`, so compile a copy with that name.

   ```sh
   cp -R icon.icon /tmp/Icon.icon
   mkdir -p /tmp/compiled
   xcrun actool /tmp/Icon.icon --compile /tmp/compiled --app-icon Icon --include-all-app-icons \
     --enable-on-demand-resources NO --development-region en --target-device mac \
     --minimum-deployment-target 26.0 --platform macosx \
     --output-partial-info-plist /tmp/compiled/partial.plist
   cp /tmp/compiled/Assets.car Assets.car
   ```

3. Render the night look once for each size you need.

   ```sh
   ictool icon.icon --export-image --output-file night-824.png --platform macOS \
     --rendition Dark --width 824 --height 824 --scale 1
   ```

4. Build `icon.ico` from the renders at 16, 24, 32, 48, 64, 128 and 256px.
5. Build `icon.icns`. For each canvas size, render the plate at 80.5% of the canvas, rounded up to an even number of pixels, and centre it over a black shadow at 30% opacity whose blur and downward offset are 1.2% of the canvas. Save `icon.png` and `../resources/icon.png` from the 1024px and 256px images.
6. Redraw the three SVG files and render `icon-ios.png`. The iOS plate stays square and opaque.
7. Copy the files the web app and the docs site share.

To check the development bundle without launching Electron, run this from `packages/desktop`:

```sh
pnpm exec node --test scripts/test-dev-icon.mjs
```

The test runs only on macOS. It builds temporary bundles and checks the icon, the plist, the signature, cache reuse and invalidation.
