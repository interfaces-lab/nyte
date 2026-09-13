# Cursor update/restart interface

Inspected Cursor 3.20.10 in `/Applications/Cursor.app` on macOS. This is a behavioral reconstruction from the installed bundles, native symbols/disassembly, and local update traces—not Cursor source code.

## Main finding

The restart window is not a workbench dialog and is not styled by Cursor's CSS.

```text
workbench UI
    │  quitAndInstall IPC
    ▼
Electron main process
    │  snapshot update + copy/launch helper
    ├──────────────────────────────► Electron autoUpdater / Squirrel / ShipIt
    ▼
standalone signed Swift helper
cursor-update-supervisor
    │
    └── AppKit NSPanel that survives Cursor quitting and its bundle being replaced
```

The relevant installed files are:

- `/Applications/Cursor.app/Contents/Resources/app/out/main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/platform/update/electron-main/darwinUpdateExitWatchdog.js`
- `/Applications/Cursor.app/Contents/Resources/app/resources/helpers/cursor-update-supervisor`

The helper is copied outside the app bundle before installation. That lets it remain alive while Squirrel replaces `Cursor.app`.

## Update protocol

Before quitting, the main process records a manifest with the installation ID, current and target versions, app path and bundle ID, appearance, original bundle inode, and ShipIt log offset. It writes `active.json` atomically, launches the copied helper, calls Electron's `autoUpdater.quitAndInstall()`, and arms an exit watchdog for a stuck old process.

The helper polls every 250 ms and combines several signals:

- ShipIt's state plist
- new lines in ShipIt's stderr log
- existence and inode of the app bundle
- `CFBundleShortVersionString` in the installed bundle
- old/new Cursor process state
- an `app-ready.json` handshake from the restarted app

Its internal phases are:

```text
armed → waitingForOldApp → installing → swapped → restarting → confirmed
                                                           └── failed/recovery
```

A successful result is not declared merely because the bundle was replaced. The relaunched app must report ready with the matching installation ID and target version.

Local protocol and trace files live under:

- `~/Library/Application Support/Cursor/update-supervisor/`
- `~/Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt/`

## Native window

The helper's `NativeSupervisorWindowController` creates a native AppKit `NSPanel`:

- content size: **372 × 84 pt** during normal operation
- title: `Updating Cursor (<version>)`
- titled and closable native panel
- 56 pt app icon
- 24 pt horizontal outer inset
- 8 pt icon-to-copy gap
- 10 pt top inset for the status label
- 12 pt semibold system status text
- native determinate `NSProgressIndicator`, 7 pt below the label
- appearance is captured from Cursor before shutdown

The user-facing stages and progress values are:

| Stage | Label | Progress on a 0–3 scale |
|---|---|---:|
| Preparing | `Preparing update` | 0.4 |
| Installing | `Installing update` | 1.4 |
| Restarting | `Restarting Cursor` | 2.4 |
| Slow path | `Still updating Cursor` | unchanged |
| Complete | `Cursor updated` | 3.0 |
| Failed | `Cursor couldn't finish updating` | progress hidden |

This is coarse semantic progress rather than downloaded-byte or installation-percentage progress. The screenshot's restart state is therefore fixed at 2.4/3, or 80%.

For a failure, the panel grows to **372 × 110 pt**, hides the progress bar, shows an **Open Cursor** button, activates itself, and comes to the front. It keeps observing the app for recovery and can convert a late healthy launch into recovered success.

The slow-path label is deliberately delayed. The thresholds visible in the helper are 15 seconds while waiting for the old app, 60 seconds while installing, and 20 seconds around swap/restart.

## Observed timing

Recent successful traces took roughly 15–19 seconds end to end. A representative update spent about 7–9 seconds reaching bundle replacement and another 4–5 seconds waiting for the relaunched app's ready confirmation.

## What Cursor is optimizing for

1. **Continuity across self-replacement.** The UX runs outside the process and bundle being updated.
2. **Truthful milestones.** It shows a small number of states instead of pretending to know exact progress.
3. **Confirmation, not hope.** Success requires a handshake from the new app.
4. **Redundant observation.** ShipIt logs, filesystem identity, versions, processes, and handshake files cover one another's blind spots.
5. **Failure as a separate UI mode.** Recovery controls appear only when needed; the normal panel stays compact.
6. **Native resilience.** AppKit gives a lightweight window independent of the Electron renderer, workbench startup, and web assets.

The reusable idea is not Cursor's exact panel styling. It is the small, independently executable supervisor and the durable file-based protocol around the updater.