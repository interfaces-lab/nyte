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
pnpm --dir packages/desktop package
```

This builds the installers for the machine you run it on: on a Mac, the arm64 DMG, ZIP, blockmaps and `latest-mac.yml` in `dist/`. `package:app` builds only the unpacked app bundle. To build one artifact, pass electron-builder's target after `--`, as in `pnpm --dir packages/desktop package -- --mac zip --arm64`.

Before you announce a release, install the previous version and update it. Check the download, the installation and the automatic relaunch, then confirm another check says Nyte is up to date.

## Install a local build

```sh
pnpm install:desktop
```

This replaces `/Applications/Nyte.app` with a build of the checkout through the app's own updater, the way a nightly arrives. It builds a signed nightly ZIP, versioned like a nightly with the time of day as its run, and serves it on a loopback port. Then it quits Nyte and reopens it with `NYTE_UPDATE_FEED_PORT` set to that port. A packaged app with that variable checks `http://127.0.0.1:<port>` instead of GitHub. Once `updates.log` reports the download, the script quits Nyte so the update installs on quit, and opens the new version. Squirrel.Mac still checks the Developer ID, so the build must be signed with yours. Apple's timestamp server sometimes drops a signing request, so a failed build runs again, up to three times per run, before the script gives up and leaves the installed app alone.

The installed app has to be on the nightly channel, and it has to be a build that reads `NYTE_UPDATE_FEED_PORT`. Replace an older build by hand once. A local build carries today's date, so a nightly from GitHub replaces it from the next day on.

## Local update test

```sh
pnpm --dir packages/desktop update:test
```

This builds the real app as **Nyte Update Test** 1.0.0 and 1.0.1, signed with your Developer ID but not notarized. It serves 1.0.1 on `http://localhost:8917` until you stop it. Open the 1.0.0 app the script prints and choose **Check for Updates…**. After the restart, About shows 1.0.1 and another check says it is up to date.

The test app has its own identity, Electron profile and `NYTE_HOME` under `~/Library/Application Support/Nyte Update Test`, so it leaves your installed Nyte alone. It is still the real app. Opening a workspace and running tools can change that workspace. Remove the temporary folder the script prints when you're done.
