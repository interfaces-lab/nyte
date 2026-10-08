# @nyte-ai/ios

Nyte's iOS app. It controls a running Nyte host: the desktop app, or `nyte serve`
on another computer. The host owns sessions, folders, model credentials, and tool
execution, and keeps working after the app closes. The app reads the host through
`@nyte-ai/client` and `@nyte-ai/protocol`, including the Node-free
`SessionObserver` that holds transcript state and recovers a dropped watch.

User steps are in the [remote access guide](../docs/content/docs/remote-access.mdx).
This README covers how the app works, how to build it, and how it is published.

## What it does

- **Inbox.** One sectioned list: Needs input, Failed, Working, Pinned, then Today
  and Earlier, with search and filters. The composer pinned at the bottom starts a
  new chat.
- **Conversation.** Replies stream in order. Tool and reasoning activity stays in
  compact rows that open native detail sheets, and messages keep their original
  order around it. Stop has its own control, so it never replaces Send or the
  microphone. Long-press a message to copy its Markdown.
- **Sending during a run.** The composer offers **Steer current response** or
  **Queue after response**, matching the host's `steer` and `next` modes. A queued
  message shows as **Queued** until it lands.
- **Drafts and retries.** Text drafts are stored per host, account owner, and
  session in MMKV. A failed send keeps its draft and its saved message key, so
  retrying the same content with the same delivery choice reuses that key and the
  host accepts it once. Changing the delivery choice drops the saved key (see
  [Known gaps](#known-gaps)). A new chat keeps its session id across retries, and
  a new chat on a `nyte serve` host keeps a durable start record (see
  [Folders](#folders)).
- **Composer.** Return inserts a newline. Focus reveals a 44pt model button and a
  thinking gauge that opens a native sheet with a snapping level control. The mic
  dictates on device. `@` offers the folder's files and `/` offers commands and
  skills. Accepting one writes the same text the desktop composer writes:
  `@file:///…` for a file, `/name ` for a command, and the skill's instruction at
  the head of the draft. A draft that is only a command line runs through
  `plugins.commands.run`.
  The completion menus use native glass, the desktop command/skill/file/folder
  glyphs, and a virtualized list bounded by the native header and keyboard.
  Shared menu tokens provide 4pt wrapping and at least 44pt touch targets.
  Completed file references do not reopen search when their caret moves.
- **Photos.** Up to three JPEGs from the camera or a library grid. Markup bakes
  numbered points and drawn marks into a staged photo, and its comments travel as
  text beside it. Only Send uploads them.
- **Review and changed files.** The review page shows status, change totals, and
  the agent summary. **Ask to Merge** sends a merge instruction to the host agent;
  there is no merge, pull request, or deploy API. Changed Files switches between
  **Agent edits**, **On Mac**, and **Uncommitted**, and long patches show their
  first 400 lines until you ask for the rest.
- **Live Activity.** Working and waiting sessions mirror to a Lock Screen activity
  and the Dynamic Island.
- **Settings.** Appearance, message font, inbox display, the connection, read-only
  workspaces, and Disconnect.

There is no offline outbox and no relay discovery. The app never reports a send as
done before the host accepts it.

## Connecting a host

| Path | How it connects |
| --- | --- |
| Nyte account | Sign in with the account the host is linked to and pick the computer. The phone enrolls itself while the host has sharing on. The host has no approval step, and the app shows none. |
| Tailscale | **Connect with Tailscale**, then the host's tailnet address and token, or **Scan QR code**. |
| Local address or QR code | The same form for any other reachable address. A `127.0.0.1` share reaches only the iOS Simulator on the same Mac. |

The welcome screen offers all three. A build without account configuration shows
**Sign in to Nyte** disabled with "Account sign-in is unavailable in this build."
and never loads Clerk.

The connect form verifies `/v1/info` before saving. Each attempt can be cancelled,
and a saved host that hangs on resume is reported after ten seconds. Failure
wording lives in [`src/connection/connect-copy.ts`](src/connection/connect-copy.ts):
each stage names what happened and what to do next, and `classifyConnectFailure`
keeps a refused token, a silent host, and a server that isn't Nyte apart. Retry
appears only where the same details could still work.

A pairing code is `nyte://connect?name=…&url=…&token=…`, scanned with VisionCamera's
`useObjectOutput`. A scanned address goes through the same `parseConnection` policy
as a typed one. The scan button appears only on a device with a camera.

### Address policy

Plain HTTP is allowed for loopback, private IPv4, the Tailscale `100.64.0.0/10`
range, and `.ts.net` names, checked numerically. Everything else must be HTTPS. The
Tailscale range is shared address space, not a private network; it is allowed
because reaching it means the phone is already inside an authenticated tailnet.

App Transport Security cannot express this policy. Its exception domains are names,
and `NSAllowsLocalNetworking` does not cover a tailnet address. So
`NSAllowsArbitraryLoads` is on in `app.json`, and `parseConnection` is the real
gate. The token is stored in the Keychain and masked in the form. Autofill is off,
but iOS may still offer to save it in Passwords. No provider credentials or
deployment secrets belong in the bundle.

### Host identity

A host that advertises an identity in `/v1/info` must sign a fresh nonce on
`/v1/identity`, which the app checks with `@noble/curves` Ed25519, because Hermes
has no WebCrypto Ed25519. The first proven key is pinned per route: a typed or
scanned address, or an account's broker, owner, and environment. Once a route has a
pin, its host must prove that key; a different key or none is refused as
**Different host** until the user taps **Pair as New Host**. A pin outlives
disconnects and sign-outs. A `nyte serve` host that names no identity is refused as
**Host not verified**.

The check runs before a connection is saved or adopted, when a saved connection is
loaded at launch, and on **Try Again**. It does not repeat on every request.

Desktop shares name no identity. They still connect, but the app can't tell them
apart from another host at the same address.

### Folders

A desktop host has a current folder. The folder menu offers Home and recent
folders through `workspace.select`.

A `nyte serve` host has a registry. The folder menu lists only folders that host
already trusts, and the choice belongs to this phone and host. The app connects as
a controller and has no screen for adding folders. The first message starts the
chat through `environment.start`. Before sending, the app writes the whole start
(request id, folder, model, thinking level, and message) to MMKV. A retry or a
relaunch sends that record unchanged. Changing the folder afterwards doesn't send
anything, and the waiting start keeps its original folder. A second start is
refused until the waiting one is opened or edited, so one message cannot create
two chats.

## Nyte account

Account sign-in needs two public values, inlined at build time:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key; must encode a bare Frontend API host |
| `EXPO_PUBLIC_NYTE_CONNECT_ORIGIN` | Broker and relay origin, a canonical `https://host[:port]` |

[`src/account/account-config.ts`](src/account/account-config.ts) turns the account
off unless both parse. Local Expo commands read them from `packages/mobile/.env.local`.
EAS builds read the project's environment variables on expo.dev, because the local
file is ignored by Git. Set both as plain-text project variables for `development`,
`preview`, and `production`; `eas.json` selects the matching environment per build
profile, and EAS Update takes `--environment development|preview|production`. Use
the same Clerk instance as the Worker and desktop. The current Worker uses the
production Clerk instance at `clerk.nyte.sh` and serves
`https://nyte-connect.daniel-fu90.workers.dev`.

Every host is reached through the broker's relay at `<origin>/r/<environment id>`.
The host holds an outbound connection to it, so it needs no inbound port, DNS name,
or tunnel. The phone builds that address from the origin and the picked
environment's id; no broker answer names an address. Broker and relay share one
origin, so the phone sends no cookies on any account request.

The account flow is one panel, [`src/account/connect-panel.tsx`](src/account/connect-panel.tsx).
The welcome screen shows it inline. Once connected, the account button in the Inbox
header opens it in a native page sheet with the connected computer, the account,
and Your computers.

Sign-in is Clerk's hosted page in an ephemeral `ASWebAuthenticationSession`, started
with `useHostedAuth().startHostedAuth({ mode: "sign-in" })`, so Safari keeps no
portal session that could sign the previous account back in. Clerk's client token
lives in the Keychain through `@clerk/expo/token-cache`. Each broker call gets a
fresh standard session JWT, `getToken({ skipCache: true })`, with no template. The
Clerk instance must add an `aud` claim equal to the broker origin, which the broker
checks. If Clerk refuses the app's bundle (`resource_missmatch`), the panel shows
**Sign-in unavailable** and points to Tailscale or a local address.

### Enrollment

1. The phone draws 32 bytes from `getRandomBytesAsync`, never the synchronous call
   that can fall back to `Math.random`, encodes them as the device bearer, and
   hashes that text with SHA-256.
2. `POST /v1/environments/:id/devices` carries only `clientId`, `clientName`, the
   digest, and `role: "controller"`. The broker has the host record the device
   before it answers.
3. The answer must name the picked environment; anything else is refused before the
   bearer goes anywhere.
4. The phone calls `/v1/info` through the relay with the new bearer. A just-enrolled
   device can be refused while the host's lease catches up, so a refusal is retried
   with the same bearer for `ENROLLMENT_READINESS_SECONDS`. Nothing enrolls again.
5. The host must prove the identity pinned for that environment, as above.
6. The connection, with broker origin, environment, device, and owner, is written to
   the Keychain under a signal that any account change aborts.

`clientId` is per install and per account, so reconnecting replaces this phone's
earlier device, and two accounts on one phone get different ids.

Only the saved connection holds the bearer: no query cache, URL, or log.
[`src/connection/connection-store.ts`](src/connection/connection-store.ts) runs saves
and removals in one queue, so a save that started before a sign-out cannot land
after it. An abort during the write restores the previous connection. If that undo
fails too, the store serves nothing and reports the failure.

Restoring an account connection holds it to the enrollment policy: the broker must
be this build's broker and the address exactly its relay for the saved environment,
with no other path, query, or fragment. A build pointed at another broker refuses
the saved connection and asks for the computer again. There is no migration between
brokers.

The device bearer outlives the Clerk session. A saved host keeps working after the
session expires or the phone goes offline; only Your computers needs a sign-in. A
host that refuses the bearer shows **Not accepted** in Settings with **Reconnect**,
which opens the panel to pick it again. The app never re-enrolls on its own,
because a revoked device must stay revoked.

Each owner change, from sign-in, Switch Account, or a session Clerk restores at
launch, aborts the previous owner's enrollment, Keychain write, and computer list.
The connection gate never serves another owner's host once Clerk names a different
owner. Signing out, or a session expiring, keeps the saved host.

### Release and revoke

A release is `DELETE <relay address>/_nyte/connect/device` with the device's own
bearer. The host refuses the bearer at once and queues the broker's release, which
frees the device's slot and leaves Clerk sessions alone. 204 means released; 401 or
403 means the relay or host already refuses the bearer, which counts the same. No
other answer counts, including the relay's 503 for a host that isn't connected. The
phone releases:

- a bearer it does not keep: a cancelled connect, an account change during one, an
  expired readiness window, a failed identity check, or a failed save;
- the host a save replaced;
- the saved host on Disconnect, which keeps the Nyte sign-in;
- another account's host when a different owner signs in.

Sign Out revokes instead: the broker's `revokeDevice` first, which also ends the
Clerk session that enrolled the device, then the release on the host as a best
effort, each within five seconds. It then deletes the connection and client id and
signs Clerk out. The toast says only what answered: the host removed this iPhone,
the host stops accepting it within a minute when its lease runs out, or neither
answered and the user should remove it on the host.

### Clerk native setup

The `@clerk/expo` config plugin runs with `appleSignIn: false`, so no Sign in with
Apple entitlement is added. It raises the iOS deployment target to 17.0 and links
Clerk's native module, so it needs a new binary; an over-the-air update cannot add
it.

Hosted auth returns to `<bundle identifier>://callback`, which
`ASWebAuthenticationSession` catches without an Info.plist URL type. Each variant's
callback must be allowed under Native applications in the Clerk dashboard:
`dev.nyte.ios://callback`, `dev.nyte.ios.preview://callback`, and
`dev.nyte.ios.dev://callback`.

## Development

Local builds use Expo SDK 57 and Xcode 27's iOS 27 SDK. Select Xcode for the current
terminal without changing the system setting:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

From the repository root:

```sh
pnpm install
pnpm --dir packages/mobile prebuild:dev --clean
cd packages/mobile/ios
pod install
```

Start Metro yourself, then build and launch from another terminal with the same
`DEVELOPER_DIR`:

```sh
pnpm --dir packages/mobile dev
pnpm --dir packages/mobile ios
```

`dev`, `ios`, and `prebuild:dev` select the development variant (Nyte Dev,
`dev.nyte.ios.dev`, `nyte-dev`). The Debug build includes `expo-dev-client`, so
local testing needs Xcode and Metro but no EAS build. For a connected iPhone, run
`pnpm --dir packages/mobile ios --device`, enable Developer Mode on the phone, and
pick your Apple team when Xcode asks. Only the development variant registers
Expo's generated `exp+nyte-ios` scheme, so a Metro QR code opens Nyte Dev when other
variants are installed.

For a local production build, run
`APP_VARIANT=production pnpm --dir packages/mobile prebuild --clean`, install Pods
again, then use `ios:release` or `ios:build`. `ios:release` builds and launches a
Release app without Metro. `ios:build` skips Pods and copies the `.app` into
`build/app`. `bundle` writes the Hermes bundle to `build/export`. `build/`, `ios/`,
and `dist/` are ignored by Git.

Expo Go cannot run this app. Native Markdown, SF Symbols, MMKV, VisionCamera,
speech recognition, Live Activities, and the photo access module all need a
development or Release build. Run `prebuild --clean` and `pod install` again after
changing native dependencies, config plugins, or anything under `modules/`.

The native Xcode project is generated from `app.json` and `app.config.ts`. Change
app config, not generated files. Real-device signing needs your own Apple team.
Simulator pairing needs ad hoc signing: a build with `CODE_SIGNING_ALLOWED=NO`
compiles but cannot save the token in the Keychain. Use Expo's iOS command, or
`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`.

If CocoaPods picks an SDK from mismatched Command Line Tools, use the selected
Xcode's SDK:

```sh
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" pod install
```

### Native notes

| Piece | Why it is there |
| --- | --- |
| `plugins/with-scene-lifecycle.cjs` and `NyteSceneDelegate.swift` | The iOS 27 SDK requires a single-window scene delegate, and Expo 57 still generates the older app lifecycle ([Expo issue 46664](https://github.com/expo/expo/issues/46664)). The adapter forwards lifecycle and link events through Expo. Remove both once a stable Expo template includes `ExpoAppSceneDelegate`. |
| `modules/nyte-photo-access` | A local Expo module that presents the limited-library picker and resolves when it closes, a callback the installed Expo API lacks. Autolinking picks it up from `modules/`; no shared dependency is patched. |
| `expo-media-library` with `preventAutomaticLimitedAccessAlert` | The photo panel has its own access control, so iOS's automatic limited-access reminder is off. Photo permission is requested only after an explicit Photos action. |
| `@use-voltra/ios-client@2.3.2` pnpm patch | Backports [Voltra's distinct pod module fix](https://github.com/callstackincubator/voltra/pull/330): the app uses `VoltraRuntime` and the extension `VoltraWidgetRuntime`, so an archive doesn't produce two `Metadata.appintents`. Remove it when a Voltra release includes the fix. |
| MMKV | A Nitro module. It ships Nitrogen output built against `react-native-nitro-modules` 0.35, two minors behind the version VisionCamera and Nitro Image pin here. Check the Pods build after upgrading either side. |
| Home-screen icon | `../desktop/build/icon-ios.png`: the desktop artwork on a square plate. The Dock-padded desktop PNG shows a white strip under iOS's mask. |

### Completion icons

The `@` and `/` menus draw the desktop's file, folder, command, and skill glyphs.
`pnpm icons:sync` renders them from the installed `central-icons` package in
`packages/ui` to `build/completion-icons.json`. `typecheck` and `metro.config.cjs`
run it first, so the generated file exists before TypeScript or Metro reads it. The
output stays under the ignored `build/` directory, and no web rendering code enters
the app bundle.

### Development shortcuts

In a development build, open Expo's developer menu with the floating gear or a shake.
Nyte adds shortcuts for the Inbox, Settings, a conversation, review, and changed
files; conversation shortcuts use the open session or the host's most recent one.
Connect a host first. The menu also has Live Activity previews (working and needs
input) with their own activity identity and a stop control; they use sample data
and start no host task. See Expo's
[custom developer menu items](https://docs.expo.dev/versions/latest/sdk/dev-menu/#extending-the-dev-menu).

On the welcome screen, **Preview the redesign** opens a sample transcript built from
the real message and activity components. It needs no host and makes no network
requests.

## Builds and variants

`app.json` holds what every build shares. [`app.config.ts`](app.config.ts) layers
three variants on top, chosen by `APP_VARIANT`:

| `APP_VARIANT` | Name | Bundle identifier | Scheme | APNs | Runtime version |
| --- | --- | --- | --- | --- | --- |
| `development` | Nyte Dev | `dev.nyte.ios.dev` | `nyte-dev` | `development` | `appVersion` |
| `preview` | Nyte Preview | `dev.nyte.ios.preview` | `nyte-preview` | `production` | `fingerprint` |
| unset or `production` | Nyte | `dev.nyte.ios` | `nyte` | `production` | `fingerprint` |

The identifiers differ so the three install side by side. An unset variant resolves
to production, because a release must not get it wrong by omission. Each variant's
Live Activity app group is `group.<bundle identifier>`, so one variant cannot read
another's activity state, and the Live Activity opens the variant's own scheme.

The fingerprint policy hashes native dependencies, config plugins, and patches, so
an update reaches only a binary that can run it. A JavaScript-only diff doesn't
prove native compatibility, and a new native module, such as Clerk's or the photo
access module, needs a new binary. Development keeps `appVersion`, because a dev
client loads local bundles anyway.

Inspect a resolved config before building:

```sh
APP_VARIANT=preview pnpm --dir packages/mobile exec expo config --json
```

EAS profiles live in [`eas.json`](eas.json). Each sets `APP_VARIANT`, its EAS
environment, and the update channel of the same name:

```sh
pnpm --dir packages/mobile build:dev         # simulator dev client, internal
pnpm --dir packages/mobile build:preview     # internal distribution
pnpm --dir packages/mobile build:production  # App Store and TestFlight, build number auto-increments
pnpm --dir packages/mobile submit            # upload the production build
```

The EAS project is `@nameisdaniel/nyte-ios`, id
`5f78a9e7-057f-490e-ae2a-1dcdb12827d9`, stored in `app.json` under
`extra.eas.projectId`, with updates at `https://u.expo.dev/<project id>`. The build
number is remote (`appVersionSource: "remote"`). `submit` targets App Store Connect
app `6813219821`. Submission uploads a build; TestFlight, App Review, and release
are separate steps in App Store Connect.

`eas init` writes the whole resolved config back to `app.json`, including the Live
Activity extension Voltra generated for whichever variant resolved at the time.
Voltra appends rather than replaces, so `app.config.ts` drops the generated
`extra.eas.build` block before the plugin runs again. Keeping it would give a
non-production build a second extension holding the production bundle identifier.

The repository's release workflow has no iOS job, so a release tag doesn't build or
submit the app. iOS builds and submissions run through the commands above.

### APNs environment

`@use-voltra/ios-client` writes `aps-environment: development` whenever its push
support is on. Device tokens are scoped to that environment, and a token from one is
rejected by the other with no error the app can see, so a TestFlight build carrying
the sandbox entitlement would never receive pushes.
[`plugins/with-aps-environment.cjs`](plugins/with-aps-environment.cjs) runs after it
and writes the value the variant needs. It must stay last in the plugin list.

Push is enabled only at the entitlement level. Nothing sends Live Activity pushes
yet: `useWorkLiveActivitySync` drives `start`, `update`, and `end` from the app, so
the Lock Screen activity stops updating once iOS suspends the app. Moving updates
to APNs needs a sender with an Apple push key, which belongs on the host.

## Source layout

Start in `src/app/_layout.tsx` for startup, providers, the connection gate, and the
root stack. `index` is the Inbox; `settings`, `chat/[id]`, `changes/[id]`, and
`review/[id]` are pushed screens; `annotate` is a native sheet. There is no tab bar.
Route files only parse params and render the owning feature's screen.

| Location | Owns |
| --- | --- |
| `src/app/` | Expo Router routes: root layout and thin route files |
| `src/account/` | Nyte account: configuration, Clerk provider, connect panel and sheet, enrollment, release, revocation, and their wording |
| `src/connection/` | Welcome screen, connect form, pairing scanner, address policy, host identity and pins, saved-connection store, host client, and the gate's host context |
| `src/chat/` | Conversation, transcript projection, composer, drafts, send receipts, dictation, completions, model and thinking controls, attachment menu, folder menu and registry starts, sessions, and changed files |
| `src/inbox/` | The Inbox: sections, filters, and the account button |
| `src/activity/` | The Voltra Live Activity, synced from working and waiting sessions |
| `src/review/` | Review page: status, change totals, and Ask to Merge |
| `src/settings/` | Settings page and the device's display preferences |
| `src/annotate/` | Photo markup: numbered points, drawn marks, and comments |
| `src/media/` | Photo picking, recent photos, local JPEG preparation, annotation notes, and the attachment thumbnail |
| `src/development/` | Developer menu shortcuts and the design preview |
| `src/ui/` | Shared glass buttons, groups, chips, toasts, skeletons, and empty states |
| `src/theme.ts` | Light and dark tokens for native and React Strict DOM |
| `modules/nyte-photo-access/` | Local Expo module for the limited-library picker |
| `plugins/` | Source-controlled Expo native configuration |
| `scripts/` | Completion icon sync |
| `test/` | Behavior checks without native modules |

The main transcript and composer files:

| File | Owns |
| --- | --- |
| `src/chat/transcript-rows.ts` | Ordered transcript and live activity projection. An activity row is copied only when one of its tools changes. |
| `src/chat/messages.tsx` | Message bubbles and activity summaries |
| `src/chat/tool-activity-sheet.tsx` | Tool and reasoning detail sheets |
| `src/chat/markdown.tsx` | Native Markdown sized to its container |
| `src/chat/composer.tsx` | Draft, delivery, input, attachments, model, and thinking |
| `src/chat/drafts.ts` | Text draft storage |
| `src/chat/send-receipts.ts` | Persisted retry identity and delivery choice |
| `src/chat/message-scroller.tsx` | Keyboard coordination and anchoring on the exact sent message |
| `src/chat/workspace-start.ts` | Registry folder choice and the durable `environment.start` record |

`settings/preferences.ts` keeps this phone's display settings in one MMKV instance.
They describe the phone, not the host, so they never travel over the wire. MMKV
reads synchronously, so the first paint has the stored value. Each setting is one
list of value-and-label choices whose first entry is the default. Appearance stores
the argument `Appearance.setColorScheme` takes, including `unspecified` for the
system setting.

Keep a feature's state and components together, and add a shared UI component only
when several features use it. Imports point at the owning file; there are no
barrels. [Bluesky's source organization](https://github.com/bluesky-social/social-app/tree/main/src)
was reviewed for separating startup, screens, and feature components; none of its
code or styling was copied.

## Runtime ownership

Provider execution and storage stay on the host. Follow-ups call `messages.send`
while Stop stays available. Selections use core's `waitingCall(state)` projection,
protocol validation, and `runs.reply` with the exact wait identity; the app never
invents a reply outcome. Desktop and iOS share the `sessionMark` projection for
execution status.

`SessionObserver` owns bootstrap, watch recovery, and metadata refreshes. One
observer per host client and session is shared by the conversation, review, and
changed-files screens, and closes with its last consumer or when the app goes to
the background. Transcript rows and change summaries depend on the committed
transcript, so text deltas don't rebuild them.

The model menu reads `provider.models.list()`; the host filters credentials,
account restrictions, and hidden models. Choosing a model queues
`sessions.configure` and doesn't change the active run's frozen config. Both apps
must run the same protocol revision.

Photos are decoded one at a time, resized, and re-encoded as JPEGs, each capped at
230 KiB of base64 to fit the host's default request budget. Valid photos stay staged
if another fails. Camera access is requested when the camera opens; no microphone
or frame processor is used, and the session is released on dismissal. The
Simulator has no camera, so test attachments with its photo library. Dictation uses
`expo-speech-recognition`; each recording belongs to one composer and stops when
that route loses focus.

`workspace.vcs.diff` returns the current working-tree diff and is labeled that way,
since it can contain other edits. Missing diffs are shown as missing.

### Known gaps

- Two controls configure the session's model and thinking level separately, so they
  can disagree after a queued change.
- Changing the delivery choice discards an unresolved message receipt. If the host
  accepted a send but the answer was lost, a retry then sends a new key and can run
  the message twice.
- Each send prepares and stores its receipt twice, serializing photo bytes each
  time.
- The Inbox mounts every loaded session in one `ScrollView`, and its relative-time
  clock updates every row.
- Photo drafts live only in the mounted composer.
- Nothing sends Live Activity pushes (see [APNs environment](#apns-environment)).

## Design

The interface reads like a messaging app: a light gray inbox with white status
cards and inset separators, blue outgoing and gray incoming bubbles with larger
message text, and compact activity summaries that open native sheets. Reference
screenshots for that direction are kept outside the repository.

- Header actions use one native glass button, with no second ring around an icon
  or profile photo. Settings-row icons stay bare, with 44pt touch targets. Selected
  cards use a border, not a checkmark.
- The composer is one elevated glass capsule over a transparent dock, built on
  `expo-glass-effect` (Apple's `UIGlassEffect`). The input is a native text view
  inside that material. Both follow the app's light or dark appearance.
- The attachment menu ports [expo-morphing-menu](https://github.com/rit3zh/expo-morphing-menu)
  as one interaction: the plus hands off to a glass menu, rows appear in sequence,
  the menu expands into a photo grid, and an added photo flies into the measured
  composer thumbnail. It keeps Nyte's controlled draft, camera, staging, and
  annotation. The license and source revision are in [NOTICE.md](NOTICE.md).
- The `@` and `/` menus use native glass and a virtualized list that fits above the
  composer and keyboard, with 4pt gaps and 44pt minimum touch targets.
- The welcome screen uses Nyte's dithered moon. The account button shows the
  signed-in user's image.

React Strict DOM supplies the StyleX-compatible `css` API for native layout, with no
WebView. Colors come from the shared roles in `packages/ui` through
`@nyte-ai/ui/platform-colors`, and `pnpm --dir packages/ui check:tokens` rejects
stale native output. The app follows the system appearance by default; a Settings
override goes through `Appearance.setColorScheme`, so React Native, React Strict
DOM, navigation, and native controls switch together.

Legend List virtualizes messages. Keyboard Controller coordinates the composer and
list insets. Enriched Markdown renders replies natively, respects Reduce Motion,
and highlights code with the shared content roles. While a reply streams, `remend`
closes dangling inline markers and code highlighting waits for the closing fence.
Host failures for rename, pin, delete, or opening a link appear as toasts, and
loading lists draw skeleton rows.

### References

| Source | Used for |
| --- | --- |
| [rit3zh/expo-morphing-menu](https://github.com/rit3zh/expo-morphing-menu) at `0aca4280254850ad065987bb8641ba69ae8ac891`, MIT | Ported attachment menu, morph geometry, photo selection, Add-button text animation, thumbnail entry and removal, and photo flight. See [NOTICE.md](NOTICE.md). |
| [Margelo's AI chat demo](https://github.com/margelo/ai-chat-demo) at `6280b1f0f6d53d557b160481185e7bdfa7385cb6` | Chat and keyboard behavior. It has no license file, so none of its source is copied; the app reimplements the patterns with published libraries. Its provider connections, embedded keys, and fake history are not used. |
| Mehdi Davoodi's MIT ChatGPT model-selector demo (`@mehdi_made`) | Thinking gauge geometry and springs |
| [Reacticx](https://github.com/rit3zh/reacticx) at `58479704f1f831913970aa5e78e3691bcb9fa3f7` | Toast and shimmer patterns, reimplemented on Reanimated and Gesture Handler |
| [T3's composer layout](https://github.com/pingdotgg/t3code/blob/68c2277f500bbbb299396bcdcd0aec60dcb5db9d/apps/web/src/components/chat/ChatComposer.tsx#L5925) and [mobile thread feed](https://github.com/pingdotgg/t3code/blob/0c5771d60a8ef2db34dfbbc142f7524badc829e0/apps/mobile/src/features/threads/ThreadFeed.tsx) | The 768pt chat width, compact gutters, and `chat/conversation-layout.ts` measuring one content column and handing rows explicit widths |
| [Margelo React Native skills](https://github.com/margelo/react-native-skills), [Vercel React Native skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-native-skills), [Expo skills](https://github.com/expo/skills) | MMKV, VisionCamera v5, list item types, native UI, routing, and animation guidance |

Other design credits are in the repository's
[third-party notices](../../THIRD-PARTY-NOTICES.md#design-references).

## Package choices

| Package | Responsibility |
| --- | --- |
| `expo` 57, React 19.2, React Native 0.86 | Native build and runtime |
| `expo-router`, `react-native-screens` | File routes, native stack, sheets, header search, deep links |
| `expo-updates` | Over-the-air updates on fingerprint runtimes |
| `@nyte-ai/client`, `@nyte-ai/protocol` | Typed HTTP/SSE, boundary parsing, session observer, transcript projection, execution status |
| `@nyte-ai/connect` | Broker client, account config, enrollment, and the managed-address policy. The app never imports its signing entry. |
| `@noble/curves` | Ed25519 check of the host's identity signature |
| `@clerk/expo`, `expo-auth-session`, `expo-web-browser` | Nyte account sign-in through Clerk's hosted page |
| `@expo/ui` 57 | SwiftUI glass buttons, menus, and bottom sheets |
| `expo-glass-effect`, `expo-blur` | Glass composer and menu surfaces |
| `react-strict-dom`, `@nyte-ai/ui/platform-colors` | StyleX-compatible native layout and shared Nyte colors |
| `@legendapp/list` | Virtualized transcript and sent-message anchoring |
| `react-native-keyboard-controller` | Native keyboard coordination |
| `react-native-enriched-markdown`, `remend` | Native Markdown and repair of incomplete streamed Markdown |
| `@use-voltra/ios`, `@use-voltra/ios-client` | Live Activity and Dynamic Island |
| `expo-speech-recognition` | On-device dictation and mic level |
| `react-native-vision-camera` 5.2, `react-native-nitro-modules`, `react-native-nitro-image` | Photo capture and QR scanning |
| `expo-media-library`, `expo-image-manipulator` | Library photos and local JPEG resizing |
| `react-native-svg`, `react-native-view-shot` | Markup strokes and baking annotated photos |
| `react-native-mmkv` 4 | Drafts, send receipts, registry starts, and display preferences |
| `expo-secure-store`, `expo-crypto` | Saved token, Clerk token cache, host pins, device bearer and digest, and message keys |
| `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler` | Morphs, the thinking control, and the keyboard |
| `expo-symbols`, `expo-clipboard` | SF Symbols and message copy |
| `@tanstack/react-query` | Host reads per connection |
| `typebox` | Parsing stored records at their boundary |

React DOM stays a peer of React Strict DOM. Metro uses `expo/metro-config` with
Reanimated's wrapper for clearer error stacks. Expo's dependency check excludes only
TypeScript, which follows the repository version.

## Checks

```sh
pnpm --dir packages/mobile typecheck
pnpm --dir packages/mobile test
pnpm --dir packages/mobile bundle
```

`test` covers address and pairing-code policy, host error wording, account
configuration, enrollment (including a failed identity check), release and
revocation against a local broker and host, and the saved-connection store's
ordering, rollback, and restore policy, all without native modules. `bundle` builds
a production Hermes bundle for iOS without a dev server.

### Verification status

| Build | What ran | Result |
| --- | --- | --- |
| Earlier prototype under a separate bundle identifier | A reused signed Release simulator binary with a new Hermes bundle and no Clerk key, against a source-built headless host and a desktop-style host | Registry folder choice and first-message start, a changed host key refused until Pair as New Host, and a host without identity all passed |
| This package under the `dev.nyte.ios` identities | Resolved config for all three variants against the pre-migration configuration, typecheck, 35 tests, and a production Expo export | Passed |
| This package under the `dev.nyte.ios` identities | Signed native build and GUI journeys | Not run |

Not yet verified: a native build of this package, account sign-in with Clerk on
these identities, a packaged
`nyte serve` binary, real camera capture, microphone recognition, and performance on
a device.

Before relying on a build, check on a device:

- Send several lines, keep typing while a send is pending, and retry a failed send.
- Queue a follow-up while tools run, then watch the queued bubble land.
- Scroll up during streaming, open tool details, close them, and return to the
  latest message.
- Read long Markdown and shell output with larger text in both appearances.
- Leave a draft, return to it, then switch host and confirm drafts stay separate.
- Dictate, attach and mark up a photo, answer a waiting question, Stop, and review
  files.
