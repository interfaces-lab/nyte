# @nyte-ai/ios

Nyte's native iOS companion. The Mac host owns conversations, model credentials,
and tool execution. This package uses `@nyte-ai/client` for HTTP/SSE and the
Node-free `@nyte-ai/core/client` `SessionObserver` for transcript state and recovery.

The app is organized as a single stack behind a saved host connection: a
root Agents list with sections for needs-input, failed, working, pinned, and
earlier sessions plus a persistent capsule composer, a pushed Settings page, a
conversation with streamed replies and follow-ups, a review page, a
changed-files page with agent-edit and on-Mac diff views, an expanded compose
sheet with model choice and real on-device dictation, and a markup editor that
bakes numbered comments and drawn marks into attached photos. Working and
waiting sessions mirror to a lock-screen Live Activity automatically. Expo
Router provides stack navigation, header search and menus, and sheets; the
connect flow gates all of them.

Typing `@` offers the shared workspace's files and `/` offers the session's
commands and skills, both read from the host: `workspace.files` narrows the tree
on the Mac, and `plugins.commands.list`/`plugins.resources.list` — or
`plugins.catalog` before a conversation exists — supply the rest. Accepting one
writes the same text the desktop composer writes, so a message sent from a phone
reads back there as the same chip: `@file:///…` for a file, `/name ` for a
command, and the skill's instruction sentence at the head of the draft. A draft
that is only a command line runs the command through `plugins.commands.run`
instead of being sent as text.

The app supports a saved host connection, chat status, streamed replies,
follow-up messages while a run works, a separate Stop action, answers to waiting
selections, and host-backed model selection. Stop keeps its own control beside
the field, so it never replaces Send or the microphone. Changed-file review
shows run evidence and lets you inspect the current workspace diff; long patches
render their first 400 lines with the rest one tap away. Opening review
preserves the composer and selection drafts. Returning from background reloads
the list in place and rechecks the host. Failed sends retain the draft and retry
key while that conversation remains open. Long-pressing a completed message or
an expanded disclosure offers Copy, which copies its Markdown source. Photo
library selection and VisionCamera capture stage up to three JPEGs locally; only
Send transmits them. Markup keeps an undo for the last point or stroke and
confirms before discarding. The review page's merge action sends a merge
instruction to the host agent. There is no dedicated merge, pull-request, or
deployment API, so its result arrives in the transcript like any other run, and
both entry points call it "Ask to merge". A durable offline outbox and relay
discovery are not implemented.

## Connecting

Nyte desktop exposes the connection under Settings › Server › iOS app. It offers
two reaches. **Simulator on this Mac** binds `127.0.0.1`; **Over Tailscale** binds
this machine's tailnet address, read from `tailscale status --json`, and is offered
only while that daemon reports `Running`. Either way the listener takes an ephemeral
port and a random token, and offers Copy address and Copy token. The app's connect
screen takes a name, that address, and that token, then verifies `/v1/info`
before saving. Verification gives up after ten seconds and can be cancelled, so
a wrong address does not hold the form.

Because each start issues a new address and token, Settings › Edit address and
token reopens the same form on the saved details, with Cancel returning to the
list. Disconnect stays separate and still deletes the saved token. When the list
cannot reach the host it offers Try again and a way into those settings.

The connect screen can also read a pairing code: `nyte://connect?name=…&url=…&token=…`,
scanned with the back camera through VisionCamera's `useObjectOutput`, which
reads QR codes through AVFoundation without an ML dependency. A scanned address
goes through the same `parseConnection` policy as a typed one, so a public HTTP
host is refused either way. The Mac does not publish such a code yet, and a
simulator has no camera, so the scan button only appears on a device with one.

A loopback share reaches only the iOS Simulator on the same Mac. A Tailscale share
reaches a physical iPhone signed in to the same tailnet, on any network, and
nothing on the local wifi: the listener binds the tailnet address alone. A public
relay and remote access without Tailscale are not supported yet.

Plain HTTP is accepted for loopback, private IPv4 addresses, the Tailscale
`100.64.0.0/10` range, and `.ts.net` names, checked numerically; anything else
must be HTTPS. The Tailscale range is shared address space rather than a private
network, so it is allowed for a narrower reason than the others: reaching one
means the device is already inside an authenticated tailnet.

That `parseConnection` check is the real gate, because App Transport Security
cannot express it: ATS exception domains are domain names, so nothing can permit
cleartext to `100.64.0.0/10`, and `NSAllowsLocalNetworking` does not cover a
tailnet address. `NSAllowsArbitraryLoads` is therefore on in `app.json`, and the
address policy above decides what may be reached. The token is stored
in the iOS Keychain and masked in the form by default. Autofill is disabled in
the input configuration, but iOS may still offer to save it in Passwords. No
provider credentials or deployment secrets belong in the bundle.

Connect-screen wording lives in [`src/connection/connect-copy.ts`](src/connection/connect-copy.ts)
rather than in the screen. Each stage of an attempt owns a title naming what
happened and a body naming what to do next, and `classifyConnectFailure` decides
which stage a failure is: a server that refuses the token, one that never
answers, and one that answers as something other than Nyte need different
instructions. Retry is offered only where the same details could still work.

## Development

Verified with Expo SDK 57 and Xcode 27 beta's iOS 27 SDK. Select the beta
for the current terminal without changing the system Xcode setting:

```sh
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
```

From the repository root:

```sh
pnpm install
pnpm --dir packages/ios prebuild
cd packages/ios/ios
pod install
```

From the repository root, start Metro yourself, then build and launch in
another terminal with the same `DEVELOPER_DIR`:

```sh
pnpm --dir packages/ios dev
pnpm --dir packages/ios ios
```

The local scene lifecycle config plugin supplies the single-window scene delegate required by the iOS 27 SDK. Expo 57 still generates the older app lifecycle, as tracked in [Expo issue 46664](https://github.com/expo/expo/issues/46664). Remove the plugin and its Swift adapter once a stable Expo prebuild template includes `ExpoAppSceneDelegate`. The adapter keeps window creation in the scene and forwards lifecycle and link events through Expo.

MMKV is a Nitro module, so adding it needs a fresh `prebuild` and `pod install`
before the app will launch. It ships its own Nitrogen output built against
`react-native-nitro-modules` 0.35, one minor behind the version VisionCamera
and Nitro Image pin here; check the Pods build after upgrading either side.

Native Markdown and SF Symbols require a development build; Expo Go cannot
load them. Voltra's `NyteLiveActivity` extension and on-device speech
recognition also require the development build — Live Activities are not
available in Expo Go. The Voltra plugin generates the extension target, its
`group.dev.nyte.ios` app group, and `NSSupportsLiveActivities` at prebuild
time; the speech plugin supplies the microphone and speech-recognition usage
descriptions. The native Xcode project is generated from `app.json` and `app.config.ts`
and ignored by
Git. Change app config rather than editing generated native files. Real-device
signing requires your own Apple team.

`ios:release` builds and launches a Release app without Metro. `ios:build`
does the same without installing Pods and copies the built `.app` into
`packages/ios/build/app`; `bundle` writes the Hermes bundle to
`packages/ios/build/export`. The `build/` directory is ignored by Git, as are
`ios/` and `dist/`. Xcode's own DerivedData stays in its default location.

If CocoaPods selects an SDK from mismatched Command Line Tools, explicitly
use the SDK from the selected Xcode:

```sh
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" pod install
```

## Builds and variants

`app.json` holds everything the builds share. [`app.config.ts`](app.config.ts)
layers three variants on top of it, chosen by `APP_VARIANT`:

| `APP_VARIANT` | Name | Bundle identifier | Scheme | APNs |
| --- | --- | --- | --- | --- |
| `development` | Nyte Dev | `dev.nyte.ios.dev` | `nyte-dev` | `development` |
| `preview` | Nyte Preview | `dev.nyte.ios.preview` | `nyte-preview` | `production` |
| unset or `production` | Nyte | `dev.nyte.ios` | `nyte` | `production` |

The identifiers differ so the three install side by side. An unset variant
resolves to production, because that is the one a release must not get wrong by
omission. Each variant's Live Activity app group follows its bundle identifier,
so one variant cannot read another's activity state.

Inspect a resolved config before building:

```sh
APP_VARIANT=preview pnpm --dir packages/ios exec expo config --json
```

EAS profiles live in [`eas.json`](eas.json) and set `APP_VARIANT` per profile:

```sh
pnpm --dir packages/ios build:dev         # simulator dev client
pnpm --dir packages/ios build:preview     # internal distribution
pnpm --dir packages/ios build:production  # App Store and TestFlight
pnpm --dir packages/ios submit            # upload the production build
```

The EAS project is `@nameisdaniel/nyte-ios`; its id lives in `app.json` under
`extra.eas.projectId`. `eas init` writes the whole resolved config back to that
file, including the Live Activity extension the Voltra plugin generates for
whichever variant resolved at the time. That plugin appends rather than
replaces, so `app.config.ts` drops the generated `extra.eas.build` block before
the plugin runs again; keeping it would give a non-production build two
extensions, one of them holding the production bundle identifier.

### APNs environment

`@use-voltra/ios-client` writes `aps-environment: development` into the
entitlements whenever its push support is on, whatever is being built. Device
tokens are scoped to the environment named there, and a token minted under one
is rejected by the other without an error the app can see, so a TestFlight build
carrying the sandbox entitlement would fail to receive pushes.
[`plugins/with-aps-environment.cjs`](plugins/with-aps-environment.cjs) runs after
it and writes the value the variant needs. It must stay last in the plugin list.

Push is enabled at the entitlement level only. Nothing sends Live Activity
pushes yet: `useWorkLiveActivitySync` drives `start`, `update`, and `end` from
the app, so the Lock Screen activity stops updating once iOS suspends the app.
Moving those updates to APNs needs a sender holding an Apple push key, which
belongs to the host rather than this package.

## Source layout

Start in `src/app/_layout.tsx` for startup, providers, the connection gate,
and the root stack. The route tree is flat: `index` is the Agents list,
`settings`, `chat/[id]`, `changes/[id]`, and `review/[id]` are pushed screens,
and `compose`/`annotate` are native sheets. There is no tab bar; the composer
capsule sits above the root list's safe area. Route files only parse params
and render the owning feature's screen body.

| Location | Owns |
| --- | --- |
| `src/app/` | Expo Router route tree: root layout and thin route files |
| `src/connection/` | Connection form, pairing-code scanner, address validation, Keychain, host client creation, and the host context behind the gate |
| `src/chat/` | Conversation screens, list rows and grouping, composer, compose sheet, message rendering, selections, models, session list, transcript-derived changes, and remote session state |
| `src/inbox/` | The root Agents list: sections, filtering, and the floating composer |
| `src/activity/` | The Voltra Live Activity, synchronized from working and waiting sessions |
| `src/review/` | Run review page: status, change totals, and the ask-to-merge instruction |
| `src/settings/` | Settings page: host row, workspaces, connection status, disconnect, and the stored display preferences |
| `src/annotate/` | Photo markup editor: numbered points, drawn marks, and comments |
| `src/media/` | Photo picking, local image preparation, camera capture, annotation notes, and the shared attachment thumbnail |
| `src/ui/` | Shared native glass buttons and empty states |
| `src/theme.ts` | Shared colors, typography, spacing, and control dimensions |
| `plugins/` | Source-controlled Expo native configuration |
| `test/` | Behavior checks without native modules |

`chat/composer.tsx` owns drafts, attachment staging, Send/Stop controls, and the
one opaque bar the transcript scrolls under. It also owns the bottom inset: the
composer sits on the keyboard's top edge while it is open and clears the home
indicator while it is closed, so the screens around it pass no keyboard offsets
of their own. `chat/completions.ts` and `chat/suggestion-menu.tsx` own the `@`
and `/` menus.
`settings/preferences.ts` owns the device's own settings — appearance,
transcript font, and what the Agents list shows — in one MMKV instance. They
describe this phone rather than the host, so they never travel over the wire,
and the Keychain still holds the token. MMKV reads synchronously, so the first
paint already has the stored value instead of flashing a default. A setting is
one list of value-and-label choices whose first entry is the default, so the
options cannot drift from the words on screen and no setting can lack a
fallback; a hook hands a row that list together with the current choice, so a
row cannot show one setting's value over another's menu. Appearance stores the
argument `Appearance.setColorScheme` takes, including its `unspecified` for
following the system, rather than a second spelling to translate. Stored text is
external input, and `settings/choice.ts` keeps that resolution free of native
imports so `test/preferences.test.ts` can check it.
`chat/messages.tsx` owns message and Markdown rendering. Keep a feature's state
and components together; add a shared UI component only when several features
use it. Protocol types and execution rules stay in their existing workspace
packages. Imports point directly to the owning file; there are no barrels.

[Bluesky's source organization](https://github.com/bluesky-social/social-app/tree/main/src)
was reviewed as a reference for separating app startup, screens, and feature
components. Nyte uses smaller feature folders suited to this companion app;
no Bluesky implementation or styling was copied.

## Checks

```sh
pnpm --dir packages/ios typecheck
pnpm --dir packages/ios test
pnpm --dir packages/ios bundle
```

`test` covers address validation and host error wording without native
modules. `bundle` builds a production Hermes bundle for iOS without starting a
dev server. TypeScript follows the repository version; Expo's dependency check
excludes only that compiler while enforcing its React and native library
versions.

## UI and reference

The interface follows the chat and keyboard behavior demonstrated by
[Margelo's AI chat demo](https://github.com/margelo/ai-chat-demo), reviewed at
`6280b1f0f6d53d557b160481185e7bdfa7385cb6`. That repository has no license file;
this app independently implements its patterns using published libraries.

The Agents list is one sectioned session list under a large-title header with
an integrated search field, a debounced query, and a filter menu; a new
conversation starts from the capsule composer pinned above the safe area, and
the header's compose button opens the sheet when the task needs a model or
attachments first. Sections name what they hold, so failed runs sit under Failed
rather than Needs input, the filter menu picks sections instead of re-deriving
its own rules, and each row's label reads the same status its text shows. Review and changed-files screens derive edit evidence from the transcript
rather than a second host read. Disconnect lives in Settings as a grouped
destructive row with a confirmation before removing the saved token. Version
sits in a centered footer, not a settings row. Empty screens share one
title/body scale and short, specific copy, and name the filter or search that
hid the rest.

Expo UI's SwiftUI `Button` supplies native `glass` and `glassProminent` controls
on supported iOS versions, including iOS 27. `GlassButton` is the one button
component that is not a list row: its `Host` handles SwiftUI sizing, while
React Native owns the safe area and keyboard insets. SwiftUI sizes a
string-label button to its own text and has no `.infinity` across the bridge, so
`fill` — the single action a screen asks for, such as Connect or Ask to merge —
draws an accent capsule from the shared tokens and lets the row own the width.
`prominent` means the accent tint rather than the desktop's near-black primary,
because a black capsule is not what iOS calls a prominent action.
Settings actions stay grouped list rows, and a row that opens a screen carries
the disclosure chevron. A preference resolves on the row instead: a pull-down
menu shows its value beside `chevron.up.chevron.down`, and a switch toggles in
place, so choosing one never leaves the page. Grouped cards separate from the
page by their surface alone; the hairlines between rows start under the leading
tile, or under the label in groups that have none. The home and chat capsule is a
`glassEffect` behind the React Native field; the effect paints an empty
container, since a filled SwiftUI shape would draw over it. Plus and mic are
glass circle controls. Send and stop stay solid discs so the send spinner can
sit on an opaque fill. Nyte's accent token colors primary actions; neutral controls
use the foreground token. Message content stays on solid surfaces.

React Strict DOM supplies the StyleX-compatible `css` API for native layout,
with no WebView bridge. All screens consume colors, typography, spacing, radii,
and control metrics from `src/theme.ts`. Colors are generated from the canonical
`packages/ui/src/platform-tokens.stylex.ts` through `@nyte-ai/ui/platform-colors`;
`pnpm --dir packages/ui check:tokens` rejects stale CSS or native color output.
The app follows the system appearance by default: `userInterfaceStyle` is
`automatic`, RSD `css` tokens resolve light and dark values through
`prefers-color-scheme`, and native controls read the active palette through
`useTheme()`. Settings can override it, and that override goes through
`Appearance.setColorScheme`, so `useColorScheme`, `prefers-color-scheme`, the
navigation theme, and native controls all move together instead of splitting
into a second source of truth. Native type sizes
and touch targets stay in the iOS theme rather than inheriting desktop density.

Legend List owns message virtualization and sent-message anchoring. Keyboard
Controller coordinates the composer and list insets. Enriched Markdown renders
replies natively and respects iOS Reduce Motion. Expo supplies the native build,
streaming fetch, and Keychain integration.

## Package choices

| Package | Responsibility |
| --- | --- |
| `expo` 57, React 19.2, React Native 0.86 | Native build and app runtime |
| `expo-router` | File routes, native tabs and stacks, sheets, header search, deep links |
| `react-native-screens` | Native stack and tab presentation for the router |
| `@use-voltra/ios`, `@use-voltra/ios-client` | Lock-screen Live Activity and Dynamic Island content |
| `expo-speech-recognition` | On-device dictation and mic level for the compose sheet |
| `react-native-svg`, `react-native-view-shot` | Markup strokes and baking annotated photos |
| `@expo/ui` 57 / `swift-ui` | Native glass controls and menus |
| `react-strict-dom` | StyleX-compatible native content layout |
| `@nyte-ai/ui/platform-colors` | Generated shared Nyte colors |
| `@nyte-ai/client`, `@nyte-ai/protocol` | Typed HTTP/SSE transport, boundary parsing, selection validation |
| `@nyte-ai/core/client` | Session observer, transcript projection, shared execution status |
| `@legendapp/list` | Virtualized chat and sent-message anchoring |
| `react-native-keyboard-controller` | Native keyboard coordination |
| `react-native-enriched-markdown` | Native Markdown, code, lists, and tables |
| `expo-symbols`, `expo-clipboard` | SF Symbols and local message copying |
| `react-native-mmkv` 4 | Synchronous storage for display preferences |
| `react-native-vision-camera` 5.2 | Native still-photo capture |
| `react-native-nitro-modules`, `react-native-nitro-image` | VisionCamera's required native runtime and image peers |
| `expo-image-picker`, `expo-image-manipulator` | System photo selection and local JPEG resizing |
| `expo-secure-store`, `expo-crypto` | Saved host token and message retry IDs |
| `expo-constants`, `expo-linking`, `expo-status-bar` | Router runtime peers, deep links, and status bar |
| `react-native-safe-area-context` | Device and modal insets |
| `react-native-reanimated`, `react-native-worklets` | Required native keyboard/list peers |
| `typebox` | Parse the saved connection at its boundary |

React DOM remains a peer of React Strict DOM. `expo-dev-client` supports local
native development. Metro uses `expo/metro-config` with Reanimated's supported
wrapper for clearer error stacks; it is not a runtime speed optimization. Expo's
preset already installs the Worklets transform, and Reanimated 4.5 enables its
React-commit-only hook optimization by default. The unused direct
`@react-native/metro-config` dependency was removed. Review and selection use
existing native lists and protocol APIs, without another navigation, state, or
diff-rendering package.

The demo's provider connections, RAG tools, embedded keys, patches, and fake
history are not part of this app. Model work stays on the Nyte host.

T3's [composer layout](https://github.com/pingdotgg/t3code/blob/68c2277f500bbbb299396bcdcd0aec60dcb5db9d/apps/web/src/components/chat/ChatComposer.tsx#L5925)
informs the shared 768pt maximum chat/composer width, compact mobile gutters,
and model control below the text input. Its mobile
[thread feed](https://github.com/pingdotgg/t3code/blob/0c5771d60a8ef2db34dfbbc142f7524badc829e0/apps/mobile/src/features/threads/ThreadFeed.tsx)
informs `chat/conversation-layout.ts`: the screen measures the list viewport
once, centers one content column inside the horizontal safe area, and hands
rows explicit widths. Native Markdown and the 85% user bubble wrap against
those numbers instead of inherited percentages. React Strict DOM sizes boxes as
`content-box`, so rows never combine `width: 100%` with padding. Message rows
are plain views with a small copy button in their meta line; wrapping them in
a SwiftUI host measured text without a width bound. Software Mansion's
[native Markdown](https://github.com/software-mansion/enriched-markdown) and
[Reanimated guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
inform native text rendering and keyboard coordination. The camera follows
[Margelo's current skills](https://github.com/margelo/react-native-skills/tree/main/skills)
and VisionCamera v5 API; it does not use deprecated v4 camera methods.
The [morphing menu reference](https://github.com/rit3zh/expo-morphing-menu)
informs the composer's own menus: the attachment choices and the `@`/`/` list
grow out of the capsule on one spring, on the capsule's surface, inside the
composer's opaque bar, rather than arriving as a sheet or floating over the
transcript. System SwiftUI menus still provide the model and head choices.

## Runtime ownership and remaining work

Provider execution and storage stay on the host. Follow-ups call `messages.send`
while Stop remains available. Selections use core's `waitingCall(state)` projection,
protocol validation, and `runs.reply` with the exact wait identity. Core returns
the reply outcome; the app never fabricates one from its local clock. Desktop
and iOS use the same `sessionMark` projection for execution status.

`SessionObserver` owns bootstrap, watch recovery, and metadata refreshes. iOS
subscribes to updates and closes observation in the background. Model choices
refresh metadata; answering a selection refreshes the snapshot so parked calls
remain ordered by core.

The model picker calls `provider.models.list()`; the Mac
filters credentials, account restrictions, and its hidden/disabled model
preferences. An empty host catalog clears the displayed list. Choosing a model
queues `sessions.configure`; it does not replace the active run's frozen config.
Both apps must run the same protocol revision.

Photos are decoded sequentially, resized and re-encoded locally as JPEGs. The
app retains normalized bytes across failed sends and preserves the message's
retry key while the content is unchanged. Valid photos remain staged if another selection fails. Send errors stay beside
the composer, and question errors stay in their question card. Each image is capped at 230KiB of
base64 data to leave room in the host's default request budget. The host still
owns its configurable request limit. Camera access is requested when opening
the camera; no microphone or frame processor is used. The camera session is
released on dismissal and pauses when backgrounded. Simulator has no camera;
use its photo library to test attachment staging and sending.

`runs.changes` returns file summaries. `workspace.vcs.diff` returns the current
working-tree diff and is labeled that way, since it can contain other edits.
Missing diffs are shown explicitly; this is not run-isolated patch storage.
The review page composes those same real reads; because the protocol exposes
no pull-request, deployment, or merge operation, its merge button posts a
merge instruction as a follow-up message and the host agent performs it with
its own tools.

Photo markup taps place numbered points with comments and drags draw strokes;
saving captures the image plus marks into a fresh staged JPEG and the comments
travel as text beside it. Dictation uses `expo-speech-recognition` with live
volume events for the waveform; transcripts land in the same draft and nothing
records without the permission prompt.

The Agents list mirrors the host's working sessions into a Voltra Live
Activity — lock-screen card plus Dynamic Island variants — that starts when
work appears, updates while the session set changes, and ends when nothing is
working; the system Settings toggle is the off switch. Live Activities render
Voltra JSX, not React Native views.

The [Cursor iOS study](../../output/cursor-ios-study/cursor-ios-study.html) informs
the interaction order and visual hierarchy; its iPad layouts were adapted to
iPhone rather than copied. Durable drafts across navigation to
the conversation list, offline history, and real-phone pairing remain future work.
