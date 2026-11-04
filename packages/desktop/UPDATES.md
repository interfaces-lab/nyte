# Desktop updates

The app updates through `electron-updater`: Squirrel.Mac on macOS and AppImage on Linux. Releases don't include Windows, so a Windows install stays on its version. Release archives and their `latest*.yml` metadata are assets of the public `interfaces-lab/nyte` GitHub releases.

## How updates reach you

Packaged apps check 30 seconds after startup, then every six hours on the stable channel and every hour on nightly. A found release downloads in the background. Meanwhile the account menu at the bottom of the sidebar reads **Downloading Update…**. **Check for Updates…** is in the Nyte menu, the menu bar menu and the account menu. It answers in a native dialog with one of three results:

- Nyte is up to date.
- The check or the download failed.
- The new version is ready, with **Restart to Update** and **Later**. If tasks or terminal commands are running, the dialog names them and defaults to **Later**.

Before relaunch, Nyte gives its host up to 10 seconds to close sessions and terminals cleanly.

Squirrel.Mac installs only an update signed with the same Developer ID as the running app. Production macOS builds therefore need Developer ID signing and notarization through electron-builder's Apple credentials.

## Update channel

**Settings > Developer > Update channel** picks stable or nightly for this installation. Nyte saves the choice in `updates.json` in the app's user data folder. Without a saved choice, a nightly build follows nightly and every other build follows stable.

- Changing the channel checks right away.
- Switching a nightly build to stable allows a downgrade, so the newest stable release installs even when it's older.
- On nightly, an update that is ready also installs when you quit.
- The channel doesn't change the `nyte` terminal client. Switch that with `nyte update stable` or `nyte update nightly`.

## When updates are off

| Condition | Effect |
| --- | --- |
| `NYTE_OFFLINE` set | No update requests. **Check for Updates…** explains why |
| `NYTE_SKIP_VERSION_CHECK` set | No scheduled checks. **Check for Updates…** still works |
| A source build | No updates |
| Linux outside an AppImage | No updates |

## Logs

Nyte writes update events to `updates.log` beside `updates.json`, which is `~/Library/Application Support/Nyte/updates.log` on macOS. The log holds event names, versions and errors. It doesn't hold update request headers.

## Build and publish

The release workflow builds and publishes the desktop app with every release. [RELEASING.md](../../RELEASING.md) covers it.

To build installers yourself, without publishing:

```sh
pnpm --dir packages/desktop package:mac
```

This writes the DMG, ZIP, blockmaps and `latest-mac.yml` to `dist/`. macOS builds are arm64 only. Other scripts build other targets:

| Script | Builds |
| --- | --- |
| `package` | Installers for the current platform |
| `package:mac:dmg`, `package:mac:zip` | One macOS artifact |
| `package:linux`, `package:linux:appimage` | Linux installers, or the AppImage alone |
| `package:win`, `package:win:nsis` | Windows installers, or the NSIS installer alone |
| `package:app` | The unpacked app bundle |

Before you announce a release, install the previous version and update it. Check the download, the installation and the automatic relaunch, then confirm another check says Nyte is up to date.

## Local update test

```sh
pnpm --dir packages/desktop update:local
```

This builds the real app as **Nyte Update Test** 1.0.0 and 1.0.1, signed with your Developer ID but not notarized. It serves 1.0.1 on `http://localhost:8917` until you stop it. Open the 1.0.0 app the script prints and choose **Check for Updates…**. After the restart, About shows 1.0.1 and another check says it is up to date.

The test app has its own identity, Electron profile and `NYTE_HOME` under `~/Library/Application Support/Nyte Update Test`, so it leaves your installed Nyte alone. It is still the real app. Opening a workspace and running tools can change that workspace. Remove the temporary folder the script prints when you're done.
