# Desktop updates

Nyte desktop uses `electron-updater` and the public `interfaces-lab/nyte` GitHub releases, alongside the TUI's releases. Desktop artifacts are separate from the TUI tarballs. Version numbers must increase; this build uses 0.0.2, matching the TUI.

The Nyte application menu includes **Check for Updates…**. Packaged apps also check 15 seconds after startup and every six hours. A new version prompts before downloading. The download is checksum-verified by electron-updater, and macOS verifies the app signature before replacing the bundle. The user chooses when to restart. Failed background checks are quiet; requested download failures are shown. Diagnostics are written to `~/Library/Application Support/Nyte/updates.log` on macOS.

`NYTE_OFFLINE` disables update requests. `NYTE_SKIP_VERSION_CHECK` disables scheduled checks while retaining the menu action. Source builds do not update themselves. Linux auto-update requires an AppImage installation.

## Build locally

```sh
pnpm --dir packages/desktop dist:mac
```

This builds the app, then creates an arm64 DMG, the ZIP required by Squirrel.Mac, blockmaps, and `latest-mac.yml` in `packages/desktop/dist`. It never publishes. A macOS release must be signed with the same Developer ID as previous versions. Release distribution also requires Apple notarization; provide electron-builder's supported Apple credentials in the release environment. Do not embed tokens in the app.

Use `pnpm dist` for the current platform, or `pnpm dist:<platform>:<format>` for one artifact (`dist:mac:dmg`, `dist:mac:zip`, `dist:linux:appimage`, `dist:win:nsis`). macOS is arm64 only.

The application contains `Contents/Resources/app-update.yml`, generated from the publish configuration. Do not override the feed in runtime code.

## Release

1. Increment `packages/desktop/package.json` to the release version. When publishing alongside the TUI, use the same version and `v<version>` tag.
2. Build each supported platform using the same signing identity. macOS is arm64 only. Do not overwrite `latest-mac.yml` with metadata from a partial build.
3. Upload the DMG, ZIP, blockmaps, and matching `latest-mac.yml` to the public, non-draft GitHub release. Use the metadata and artifacts from the same build. A TUI-only release does not provide a desktop update.
4. Verify an installed previous desktop version can check, download, and restart into the new version before announcing it.

No release is published by the local dist command. Until the first desktop release is published, manual checks report a release/feed error and background checks remain quiet.

Reference: https://www.electron.build/v26/docs/features/auto-update/
