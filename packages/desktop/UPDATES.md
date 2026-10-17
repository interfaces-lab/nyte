# Desktop updates

Every platform uses `electron-updater`: Squirrel.Mac on macOS, NSIS on Windows, and AppImage on Linux. Release archives and their `latest*.yml` metadata live in the public `interfaces-lab/nyte` GitHub releases, separate from the TUI tarballs.

Packaged apps check 15 seconds after startup and every six hours. A found release downloads in the background, and the sidebar shows its progress. **Check for Updates…**, in the Nyte menu and the account menu, answers in a native dialog: Nyte is up to date, the check or download failed, or the new version is ready with **Restart to Update** and **Later**. If tasks or terminal commands are running, the dialog names them and defaults to **Later**.

Before relaunch, Nyte gives its host up to 10 seconds to close sessions and terminals cleanly. Update lifecycle events go to `~/Library/Application Support/Nyte/updates.log` on macOS. This log contains event names, versions, and errors, not update request headers.

`NYTE_OFFLINE` disables update requests. `NYTE_SKIP_VERSION_CHECK` disables scheduled checks while retaining the menu action. Source builds do not update themselves. Linux auto-update requires an AppImage installation.

Squirrel.Mac installs only an update signed with the same Developer ID as the running app, so production macOS builds require Developer ID signing and notarization through electron-builder's Apple credentials.

## Build and publish

1. Increment the CLI, TUI, and desktop versions together and tag `v<version>`. Development versions use `0.0.9-dev.1`, `0.0.9-dev.2`, etc.
2. Run `pnpm --dir packages/desktop package:mac`. It writes the DMG, ZIP, blockmaps, and `latest-mac.yml` to `dist/`. Nothing is published.
3. Upload the DMG, ZIP, blockmaps, and `latest-mac.yml` to the public versioned release `v<version>`. Upload Windows/Linux artifacts and their builder metadata when releasing those platforms. Do not overwrite metadata with artifacts from a partial build.
4. Test an installed previous version through download, installation, and automatic relaunch before announcing the release. Confirm another check says Nyte is up to date.

Use `pnpm package` for installers on the current platform, `pnpm package:<platform>:<format>` for one artifact (`package:mac:dmg`, `package:mac:zip`, `package:linux:appimage`, `package:win:nsis`), or `pnpm package:app` for the unpacked app bundle. macOS is arm64 only.

## Local update test

```sh
pnpm --dir packages/desktop update:local
```

This builds the real app as **Nyte Update Test** 1.0.0 and 1.0.1, signed with your Developer ID but not notarized, and serves 1.0.1 on `http://localhost:8917` until you stop it. Open the printed 1.0.0 app and choose **Check for Updates…**. After the restart, About shows 1.0.1 and another check says it is up to date.

The test app has its own identity, Electron profile, and `NYTE_HOME` under `~/Library/Application Support/Nyte Update Test`, so your installed Nyte is not touched. It is still the real app: opening a workspace and running tools can modify that workspace. Remove the printed temporary directory when done.
