# Desktop and iOS demo

The demo uses the `mobile-demo` workspace. Provider credentials stay on the Mac;
connection tokens are masked in screenshots and saved only in the simulator Keychain.

The current desktop build is copied to
`packages/desktop/dist/mobile-demo-audited` so concurrent builds cannot remove its
loaded chunks. The iOS Release app is at `packages/ios/build/app/Nyte.app`, built
with Xcode 27 beta and the iOS 27 SDK.

## Verification

- The iOS 27 app connected to the desktop listener and read a real conversation.
- Disconnect confirmation Cancel retained the saved connection; confirming
  returned to setup. The new address and token reconnected successfully.
- Connect stayed disabled with missing fields. Go focused the missing Name
  field. Reveal/hide used the same trailing control with a dummy token.
- An unsent draft survived opening and closing Review in the earlier native pass.
- The Opus 5 High audit used two fresh CLI sessions with the user's exact prompt.
  Receipts and diffs are in `/tmp/nyte-opus-ui-audit`.
- Native QA found home-row overflow and unbounded context-menu message sizing.
  Those corrections compile in the final app. Final visual recheck, model picker,
  attachment actions, and long-press verification await an unlocked Mac.

## Captures

- `ios27-connect-audited.png`: the audited connection screen on iOS 27.
- `ios-before.png`: the earlier setup UI, retained as a baseline.
- `desktop-connection.png`: earlier sharing settings with a masked token. The
  displayed ephemeral address is no longer active.
- `ios27-my-mac-menu.png`: the earlier menu design, superseded by the direct
  Disconnect action after the audit.

See the [iOS package](../../packages/ios/README.md) for feature ownership,
dependencies, and remaining product scope, and the
[Cursor study](../cursor-ios-study/cursor-ios-study.html) for the visual reference.
