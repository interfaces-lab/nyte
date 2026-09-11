# Desktop updates

macOS uses `electron-sparkle` and Sparkle's native download, installation, and relaunch UI. Windows and Linux retain `electron-updater`. Release archives live in the public `interfaces-lab/nyte` GitHub releases, separate from the TUI tarballs.

The Nyte application menu includes **Check for Updates…**. Packaged apps check 15 seconds after startup and every six hours. Downloads require user approval. On macOS, Sparkle verifies the signed archive and handles installation; Nyte closes its host and terminals before relaunch. Running sessions and terminals will close when you install. Diagnostics go to `~/Library/Application Support/Nyte/updates.log` on macOS.

`NYTE_OFFLINE` disables update requests. `NYTE_SKIP_VERSION_CHECK` disables scheduled checks while retaining the menu action. Source builds do not update themselves. Linux auto-update requires an AppImage installation. Runtime environment variables cannot redirect the production macOS feed.

## macOS signing setup

The production key has already been generated. For a separate distribution, generate its own key using Sparkle's official tool:

```sh
pnpm --dir packages/desktop exec electron-sparkle generate-keys
```

The production public key is committed in `electron-builder.config.ts`; no environment setup is required for normal packaging. `NYTE_SPARKLE_PUBLIC_KEY` can override it. Local test builds require their own disposable key and never fall back to the production key. Only the public key enters the app. Never put the private key in the repository or release assets. Keep the matching private key backed up securely and use it to sign future releases.

Sparkle's archive signature does not replace Apple code signing. Production macOS builds still require Developer ID signing and notarization through electron-builder's Apple credentials.

## Build and publish

1. Increment `packages/desktop/package.json`. Versions must increase. When publishing alongside the TUI, use the same version and `v<version>` tag.
2. Run:

   ```sh
   pnpm --dir packages/desktop package:mac
   pnpm --dir packages/desktop update:appcast dist/Nyte-<version>-mac-arm64.zip
   ```

   The second command uses the default Sparkle Keychain key. For CI, append `--key-file /secure/path/to/sparkle-key`. It stages only the specified ZIP, generates its signed appcast with versioned GitHub download URLs, and writes `appcast.xml` beside the ZIP. Neither command publishes.
3. Upload the DMG, ZIP, blockmaps, and `latest-mac.yml` from that build to the public versioned release `v<version>`. Upload Windows/Linux artifacts and their builder metadata when releasing those platforms. Do not overwrite metadata with artifacts from a partial build.
4. Maintain a separate public GitHub release tagged **desktop-updates** for the stable macOS feed. It can be marked as a prerelease so it does not become GitHub's latest release. After the versioned ZIP is publicly downloadable, upload or replace `appcast.xml` on this release. Its fixed URL is embedded in Nyte:

   ```text
   https://github.com/interfaces-lab/nyte/releases/download/desktop-updates/appcast.xml
   ```

   This keeps TUI-only releases from hiding the desktop feed. The appcast points to immutable ZIP assets on the versioned release, not to the feed release. Preserve old versioned archives. Restrict who can replace the appcast.
5. Test an installed previous version through download, installation, and automatic relaunch before announcing the release. Confirm another check finds no update.

The first Sparkle-enabled release must also be delivered through the existing `latest-mac.yml`/ZIP feed so already-installed Squirrel clients can receive it. That bridge release runs only Sparkle on macOS. Later updates use the appcast. Retain the legacy feed until old clients have a path to the bridge release.

The macOS ZIP supports both the bridge delivery and Sparkle. `Contents/Resources/app-update.yml` remains for electron-updater; Sparkle uses `SUFeedURL` and `SUPublicEDKey` in Info.plist instead.

Use `pnpm package` for installers on the current platform, `pnpm package:<platform>:<format>` for one artifact (`package:mac:dmg`, `package:mac:zip`, `package:linux:appimage`, `package:win:nsis`), or `pnpm package:app` for the unpacked app bundle. macOS is arm64 only.

## Repeatable local updates

```sh
pnpm --dir packages/desktop update:local
```

This builds the **real Nyte app** once, packages versions 1.0.0 and 1.0.1, verifies their code signatures, and generates a signed local appcast. It prints commands to start a loopback-only feed server and open the older build. Run those commands yourself, then choose **Check for Updates…**. After installation, About Nyte should show 1.0.1 and another check should find no update.

Local builds use a separate `Nyte Update Test` application identity, Electron profile, and `NYTE_HOME` under `~/Library/Application Support/Nyte Update Test`. The identity and data isolation survive relaunch without shell variables. Your installed Nyte is not replaced. This is still the real app: opening a workspace and running tools can modify that workspace.

The script uses ad-hoc code signing and a disposable Ed25519 key outside the served directory. It does not touch Keychain keys or GitHub. Only test builds allow local HTTP. Quit the test app before repeating, stop the previous server, then run the script again for fresh builds and a fresh key. No version edits to the workspace manifest are needed.

After testing, stop the server and remove the printed temporary directory, including its private key. Test profile data remains in Application Support until removed. These local checks do not verify Developer ID notarization, GitHub delivery, or production credentials. Before release, also test cancellation, failed downloads, signature rejection, and relaunch with active sessions and terminals.
